/* SPDX-License-Identifier: GPL-3.0-or-later */
/**
 * @file wifi_ao.c
 * @brief The Wi-Fi app's Active Object: scan, look at a network, join it, see where the connection stands, check it with a ping.
 */
#include "wifi_ao.h"

#include <stdio.h>
#include <string.h>

#include "glyphs.h"
#include "kit.h"

#define TAG "wifi.ao"   /**< This file's log tag. */

#define WF_MAX_NETS     KODE_SYS_WIFI_SCAN_MAX   /**< Networks a sweep keeps. */
#define WF_PASS_MAX     63U                      /**< The longest password the keypad takes. */
#define WF_SSID_MAX     32U                      /**< The longest network name. */
#define WF_FOOT_Y       402                      /**< Where a page's buttons stand. */
#define WF_HALF_W       165                      /**< One of two buttons side by side. */
#define WF_JOIN_MS      40000U                   /**< How long a join may take before the app asks the radio itself. */
#define WF_PING_COUNT   3U                       /**< Echoes per target. */
#define WF_PING_INTERNET "1.1.1.1"               /**< The host that stands for the internet. */
#define WF_BAR_W        6                        /**< One signal bar's width. */
#define WF_BAR_STEP     10                       /**< From one signal bar to the next. */
#define WF_BAR_X        288                      /**< Where a row's bars start. */
#define WF_NAME_W       196                      /**< A network row's text width, clear of the bars. */
#define WF_RSSI_STRONG  (-55)                    /**< At or above: four bars. */
#define WF_RSSI_GOOD    (-65)                    /**< At or above: three bars. */
#define WF_RSSI_FAIR    (-75)                    /**< At or above: two bars. */
#define WF_CHANNEL_5G   14U                      /**< Channels above this are 5 GHz. */

/** @brief This app's own signals. */
enum WifiKitSignals
{
    WIFIKIT_TICK_SIG = MAX_SIG   /**< The render pass: kscreen's one-shot. */
};

/** @brief One network a sweep found. */
typedef struct {
    char    ssid[KODE_SYS_WIFI_SSID_MAX];   /**< Its name, empty when hidden. */
    int8_t  rssi;                           /**< Strength, dBm. */
    uint8_t channel;                        /**< Its channel. */
    uint8_t auth;                           /**< 0 for open, else the security. */
} wf_net_t;

/** @brief What the Networks page is showing. */
typedef enum {
    WF_S_IDLE = 0,   /**< Nothing asked yet. */
    WF_S_SCANNING,   /**< A sweep runs. */
    WF_S_DONE,       /**< The list is in. */
    WF_S_EMPTY,      /**< The sweep ended with nothing. */
    WF_S_BUSY,       /**< The radio is held by something else. */
    WF_S_TAKEN,      /**< A newer Wi-Fi request took the radio. */
    WF_S_OFF         /**< Wi-Fi cannot be used. */
} wf_scan_t;

/** @brief What the Connect page is showing. */
typedef enum {
    WF_C_JOINING = 0,   /**< Waiting for an address. */
    WF_C_OK,            /**< Joined. */
    WF_C_PASSWORD,      /**< The password was turned down. */
    WF_C_NOTFOUND,      /**< The network was not heard. */
    WF_C_OTHER,         /**< Anything else. */
    WF_C_REFUSED        /**< The radio would not take the request. */
} wf_conn_t;

/** @brief One target of the connection check. */
typedef struct {
    bool     done;       /**< The answer is in. */
    bool     ran;        /**< The ping ran (false: no network, or busy). */
    uint16_t tx;         /**< Echoes sent. */
    uint16_t rx;         /**< Echoes answered. */
    uint32_t avg_ms;     /**< Mean round trip. */
} wf_ping_t;

/** @brief The Active Object's own state, private to this file. */
typedef struct {
    QActive            super;                       /**< The QP/C base; must stay first. */
    kit_t              kit;                         /**< The screens. */
    wf_net_t           nets[WF_MAX_NETS];           /**< The last sweep, strongest first. */
    uint8_t            nnets;                       /**< How many. */
    wf_scan_t          scan;                        /**< The Networks page's state. */
    bool               scan_out;                    /**< A sweep request is out. */
    uint8_t            sel;                         /**< The network a page is about. */
    char               target[KODE_SYS_WIFI_SSID_MAX];   /**< The network being joined. */
    char               pass[KODE_SYS_WIFI_PASS_MAX];     /**< The password typed, kept for Try again. */
    bool               have_pass;                   /**< The target needs one. */
    wf_conn_t          conn;                        /**< The Connect page's state. */
    kode_sys_wifi_status_t st;                      /**< Where the connection stands. */
    int8_t             rssi;                        /**< The association's strength, 0 when none. */
    uint8_t            fail;                        /**< Why the last attempt failed (kdrv_wifi_fail_t). */
    bool               joining;                     /**< The radio says a join is out. */
    uint32_t           gw4;                         /**< The router's address, 0 until AO_Net says. */
    wf_ping_t          router;                      /**< The check of the router. */
    wf_ping_t          internet;                    /**< The check of the internet. */
    uint8_t            pstage;                      /**< 0 idle, 1 router out, 2 internet out. */
    kit_name_t         name;                        /**< The text being typed. */
    lv_timer_t        *join_timer;                  /**< Ends a join that never answered. */
} WifiKitAo;

static QEvtPtr     s_queue[KQP_AO_QUEUE_LEN];                          /**< Its event queue. */
static StackType_t s_stack[KQP_AO_STACK_BYTES / sizeof(StackType_t)];  /**< Its stack, in words. */
static WifiKitAo   s_ao;                                               /**< The one instance. */

QActive * const AO_WifiKit = &s_ao.super;

static QState WifiKitAo_initial(WifiKitAo * const me, void const * const par);
static QState WifiKitAo_running(WifiKitAo * const me, QEvt const * const e);
static void   page_home(kit_t *kit, void *arg);
static void   page_scan(kit_t *kit, void *arg);
static void   page_net(kit_t *kit, void *arg);
static void   page_connect(kit_t *kit, void *arg);
static void   page_status(kit_t *kit, void *arg);
static void   page_ping(kit_t *kit, void *arg);

/* ---- Words ---- */

/**
 * @brief A security in words.
 * @param auth The authmode.
 * @return The words.
 */
static const char *auth_name(uint8_t auth)
{
    const char *s = "Secured";

    switch ( auth )
    {
        case 0U:
        {
            s = "Open";
            break;
        }
        case 1U:
        {
            s = "WEP";
            break;
        }
        case 2U:
        {
            s = "WPA";
            break;
        }
        case 3U:
        {
            s = "WPA2";
            break;
        }
        case 4U:
        {
            s = "WPA/WPA2";
            break;
        }
        case 5U:
        {
            s = "WPA2 Enterprise";
            break;
        }
        case 6U:
        {
            s = "WPA3";
            break;
        }
        case 7U:
        {
            s = "WPA2/WPA3";
            break;
        }
        default:
        {
            break;
        }
    }
    return s;
}

/**
 * @brief A security in as few characters as a row has room for.
 * @param auth The authmode.
 * @return The words.
 */
static const char *auth_short(uint8_t auth)
{
    const char *s = auth_name(auth);

    if ( 4U == auth )
    {
        s = "WPA/2";
    }
    else if ( 5U == auth )
    {
        s = "WPA2 Ent.";
    }
    else if ( 7U == auth )
    {
        s = "WPA2/3";
    }
    else
    {
        /* The full name fits. */
    }
    return s;
}

/**
 * @brief How many of four bars a strength lights.
 * @param rssi dBm.
 * @return 1 to 4.
 */
static uint8_t bars_of(int8_t rssi)
{
    uint8_t n = 1U;

    if ( WF_RSSI_STRONG <= rssi )
    {
        n = 4U;
    }
    else if ( WF_RSSI_GOOD <= rssi )
    {
        n = 3U;
    }
    else if ( WF_RSSI_FAIR <= rssi )
    {
        n = 2U;
    }
    else
    {
        /* Weak: one bar. */
    }
    return n;
}

/**
 * @brief A strength in a word.
 * @param rssi dBm.
 * @return The word.
 */
static const char *strength_word(int8_t rssi)
{
    const char *s = "Weak";

    if ( WF_RSSI_STRONG <= rssi )
    {
        s = "Strong";
    }
    else if ( WF_RSSI_GOOD <= rssi )
    {
        s = "Good";
    }
    else if ( WF_RSSI_FAIR <= rssi )
    {
        s = "Fair";
    }
    else
    {
        /* Weak. */
    }
    return s;
}

/**
 * @brief An address in network byte order as dotted text.
 * @param ip4 The address.
 * @param out Where.
 * @param cap Its size.
 */
static void ip_text(uint32_t ip4, char *out, size_t cap)
{
    uint8_t b[4];

    (void)memcpy(b, &ip4, sizeof(b));
    (void)snprintf(out, cap, "%u.%u.%u.%u", (unsigned)b[0], (unsigned)b[1], (unsigned)b[2], (unsigned)b[3]);
}

/**
 * @brief The name a row shows for a network.
 * @param n The network.
 * @return Its name, or "Hidden".
 */
static const char *net_title(wf_net_t const *n)
{
    const char *s = n->ssid;

    if ( '\0' == n->ssid[0] )
    {
        s = "Hidden";
    }
    return s;
}

/**
 * @brief Whether the Dot has an address now, on a given network or any.
 * @param me   The Active Object.
 * @param ssid The network, or NULL for any.
 * @return true when it has.
 */
static bool joined(WifiKitAo const *me, const char *ssid)
{
    bool yes = (KODE_SYS_WIFI_STATE_GOT_IP == me->st.state);

    if ( yes && (NULL != ssid) )
    {
        yes = (0 == strcmp(me->st.ssid, ssid));
    }
    return yes;
}

/**
 * @brief Read where the connection stands.
 * @param me The Active Object.
 */
static void status_read(WifiKitAo *me)
{
    if ( KODE_OK != kode_sys_wifi_status(&me->st) )
    {
        (void)memset(&me->st, 0, sizeof(me->st));
        me->st.state = KODE_SYS_WIFI_STATE_IDLE;
    }
}

/* ---- Drawing helpers ---- */

/**
 * @brief Four signal bars, some lit.
 * @param parent Where they go.
 * @param lit    How many are lit.
 * @param x      The first bar's left edge.
 * @param bottom Their common foot.
 */
static void draw_bars(lv_obj_t *parent, uint8_t lit, int32_t x, int32_t bottom)
{
    for ( uint8_t i = 0U; i < 4U; ++i )
    {
        lv_obj_t * const b = lv_obj_create(parent);
        int32_t const    h = 8 + ((int32_t)i * 6);

        lv_obj_remove_style_all(b);
        lv_obj_set_size(b, WF_BAR_W, h);
        lv_obj_set_pos(b, x + ((int32_t)i * WF_BAR_STEP), bottom - h);
        lv_obj_set_style_radius(b, WF_BAR_W / 2, 0);
        lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
        if ( i < lit )
        {
            lv_obj_set_style_bg_color(b, KUI_COLOR_TEXT_ON_BG, 0);
        }
        else
        {
            lv_obj_set_style_bg_color(b, KUI_COLOR_REST, 0);
        }
        lv_obj_remove_flag(b, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_remove_flag(b, LV_OBJ_FLAG_SCROLLABLE);
    }
}

/**
 * @brief Two buttons side by side at the foot of a page.
 * @param kit    The kit.
 * @param page   The page.
 * @param left   The left one's word.
 * @param lkind  Its kind.
 * @param lcb    Its callback.
 * @param right  The right one's word.
 * @param rkind  Its kind.
 * @param rcb    Its callback.
 */
static void foot_two(kit_t *kit, lv_obj_t *page, char const *left, kit_btn_kind_t lkind, lv_event_cb_t lcb,
                     char const *right, kit_btn_kind_t rkind, lv_event_cb_t rcb)
{
    lv_obj_t * const l = kit_button(kit, page, left, lkind, WF_HALF_W, lcb, &s_ao);
    lv_obj_t * const r = kit_button(kit, page, right, rkind, WF_HALF_W, rcb, &s_ao);

    lv_obj_set_pos(l, KIT_SIDE, WF_FOOT_Y);
    lv_obj_set_pos(r, KBSP_LCD_H_RES - KIT_SIDE - WF_HALF_W, WF_FOOT_Y);
}

/**
 * @brief The one button at the foot of a page.
 * @param kit  The kit.
 * @param page The page.
 * @param word Its word.
 * @param kind Its kind.
 * @param cb   Its callback.
 */
static void foot_one(kit_t *kit, lv_obj_t *page, char const *word, kit_btn_kind_t kind, lv_event_cb_t cb)
{
    lv_obj_t * const b = kit_button(kit, page, word, kind, KUI_ACTION_W, cb, &s_ao);

    lv_obj_align(b, LV_ALIGN_TOP_MID, 0, WF_FOOT_Y);
}

/**
 * @brief Refresh the page on the glass when it is one of these.
 * @param me The Active Object.
 */
static void refresh_if_live(WifiKitAo *me)
{
    kit_build_fn_t const cur = kit_current(&me->kit);

    if ( (page_home == cur) || (page_status == cur) || (page_connect == cur) || (page_ping == cur)
         || (page_scan == cur) || (page_net == cur) )
    {
        kit_refresh(&me->kit);
    }
}

/* ---- The radio ---- */

/**
 * @brief Ask for a sweep, once: while one is out the page just waits for it.
 * @param me The Active Object.
 */
static void scan_start(WifiKitAo *me)
{
    me->scan = WF_S_SCANNING;
    if ( !me->scan_out )
    {
        me->nnets = 0U;
        if ( KODE_OK == kode_sys_wifi_scan(&me->super) )
        {
            me->scan_out = true;
        }
        else
        {
            me->scan = WF_S_OFF;
        }
    }
}

/**
 * @brief Keep a network a sweep found.
 * @param me The Active Object.
 * @param e  The entry.
 */
static void scan_entry(WifiKitAo *me, kode_sys_wifi_scan_entry_t const *e)
{
    for ( uint32_t i = 0U; i < me->nnets; ++i )
    {
        if ( (me->nets[i].channel == e->channel) && (0 == strcmp(me->nets[i].ssid, e->ssid)) )
        {
            return;
        }
    }
    if ( WF_MAX_NETS > me->nnets )
    {
        wf_net_t * const n = &me->nets[me->nnets];

        (void)memset(n, 0, sizeof(*n));
        (void)strncpy(n->ssid, e->ssid, sizeof(n->ssid) - 1U);
        n->rssi    = e->rssi;
        n->channel = e->channel;
        n->auth    = e->authmode;
        me->nnets++;
    }
}

/**
 * @brief The sweep ended.
 * @param me The Active Object.
 * @param a  The answer.
 */
static void scan_end(WifiKitAo *me, kode_sys_wifi_scan_answer_t const *a)
{
    kode_status_t const rc = (kode_status_t)a->rc;

    me->scan_out = false;
    if ( KODE_OK == rc )
    {
        for ( uint32_t i = 1U; i < me->nnets; ++i )
        {
            wf_net_t const keep = me->nets[i];
            uint32_t       j    = i;

            while ( (0U < j) && (me->nets[j - 1U].rssi < keep.rssi) )
            {
                me->nets[j] = me->nets[j - 1U];
                j--;
            }
            me->nets[j] = keep;
        }
        if ( 0U == me->nnets )
        {
            me->scan = WF_S_EMPTY;
        }
        else
        {
            me->scan = WF_S_DONE;
        }
    }
    else if ( KODE_NO_RESOURCES == rc )
    {
        me->scan = WF_S_BUSY;
    }
    else if ( KODE_CANCELLED == rc )
    {
        me->scan = WF_S_TAKEN;
    }
    else
    {
        me->scan = WF_S_BUSY;
        KLOG_W(TAG, "scan ended with status %d", (int)rc);
    }
    KLOG_I(TAG, "scan ended: %u networks", (unsigned)me->nnets);
    if ( page_scan == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
}

/**
 * @brief The timer that ends a join nobody answered.
 * @param t The timer.
 */
static void join_timer_cb(lv_timer_t *t)
{
    WifiKitAo * const me = (WifiKitAo *)lv_timer_get_user_data(t);

    lv_timer_pause(t);
    status_read(me);
    if ( WF_C_JOINING == me->conn )
    {
        if ( joined(me, me->target) )
        {
            me->conn = WF_C_OK;
        }
        else
        {
            me->conn = WF_C_OTHER;
        }
        refresh_if_live(me);
    }
}

/**
 * @brief Ask the radio to join the target network.
 * @param me The Active Object.
 */
static void join_start(WifiKitAo *me)
{
    me->conn    = WF_C_JOINING;
    me->fail    = 0U;
    me->joining = true;
    if ( KODE_OK == kode_sys_wifi_connect(me->target, me->have_pass ? me->pass : NULL) )
    {
        if ( NULL == me->join_timer )
        {
            me->join_timer = lv_timer_create(&join_timer_cb, WF_JOIN_MS, me);
        }
        lv_timer_reset(me->join_timer);
        lv_timer_resume(me->join_timer);
        KLOG_I(TAG, "joining '%s'", me->target);
    }
    else
    {
        me->conn = WF_C_REFUSED;
    }
}

/**
 * @brief Where the connection stands, from AO_Radio.
 * @param me The Active Object.
 * @param s  The state.
 */
static void wifi_state(WifiKitAo *me, WifiStateEvt const *s)
{
    me->st.state = s->state;
    me->st.ip4   = s->ip4;
    (void)memset(me->st.ssid, 0, sizeof(me->st.ssid));
    (void)strncpy(me->st.ssid, s->ssid, sizeof(me->st.ssid) - 1U);
    me->rssi    = s->rssi;
    me->fail    = s->fail;
    me->joining = s->joining;
    KLOG_I(TAG, "wifi state %u '%s' fail %u joining %u", (unsigned)s->state, s->ssid, (unsigned)s->fail,
           (unsigned)s->joining);
    if ( WF_C_JOINING == me->conn )
    {
        if ( (KODE_SYS_WIFI_STATE_GOT_IP == s->state) && (0 == strcmp(s->ssid, me->target)) )
        {
            me->conn = WF_C_OK;
        }
        else if ( (!s->joining) && (KODE_SYS_WIFI_STATE_GOT_IP != s->state)
                  && (KODE_SYS_WIFI_STATE_CONNECTING != s->state) && (0U != s->fail) )
        {
            if ( (1U == s->fail) || (4U == s->fail) )
            {
                me->conn = WF_C_PASSWORD;
            }
            else if ( 2U == s->fail )
            {
                me->conn = WF_C_NOTFOUND;
            }
            else
            {
                me->conn = WF_C_OTHER;
            }
        }
        else
        {
            /* Still joining. */
        }
        if ( (WF_C_JOINING != me->conn) && (NULL != me->join_timer) )
        {
            lv_timer_pause(me->join_timer);
        }
    }
    refresh_if_live(me);
}

/* ---- The connection check ---- */

/**
 * @brief Ping the next target.
 * @param me   The Active Object.
 * @param host Its address or name.
 * @return true when the request was taken.
 */
static bool ping_ask(WifiKitAo *me, const char *host)
{
    return KODE_OK == kode_sys_net_ping(&me->super, host, (uint8_t)WF_PING_COUNT);
}

/**
 * @brief Start the check: the router, then the internet.
 * @param me The Active Object.
 */
static void ping_start(WifiKitAo *me)
{
    char gw[20];

    (void)memset(&me->router, 0, sizeof(me->router));
    (void)memset(&me->internet, 0, sizeof(me->internet));
    me->pstage = 0U;
    status_read(me);
    if ( !joined(me, NULL) )
    {
        return;
    }
    if ( 0U != me->gw4 )
    {
        ip_text(me->gw4, gw, sizeof(gw));
    }
    else
    {
        /* AO_Net has not told us the router yet: it is the first address of our /24. */
        uint8_t b[4];

        (void)memcpy(b, &me->st.ip4, sizeof(b));
        (void)snprintf(gw, sizeof(gw), "%u.%u.%u.1", (unsigned)b[0], (unsigned)b[1], (unsigned)b[2]);
    }
    if ( ping_ask(me, gw) )
    {
        me->pstage = 1U;
    }
    else
    {
        me->router.done = true;
        me->internet.done = true;
    }
}

/**
 * @brief A ping ended.
 * @param me The Active Object.
 * @param a  The answer.
 */
static void ping_end(WifiKitAo *me, kode_sys_net_answer_t const *a)
{
    wf_ping_t *p = NULL;

    if ( 1U == me->pstage )
    {
        p = &me->router;
    }
    else if ( 2U == me->pstage )
    {
        p = &me->internet;
    }
    else
    {
        return;
    }
    p->done = true;
    p->ran  = (KODE_OK == (kode_status_t)a->rc);
    p->tx   = a->stats.tx;
    p->rx   = a->stats.rx;
    p->avg_ms = a->stats.avg_ms;
    KLOG_I(TAG, "ping stage %u: rc %u, %u of %u, avg %u ms", (unsigned)me->pstage, (unsigned)a->rc,
           (unsigned)a->stats.rx, (unsigned)a->stats.tx, (unsigned)a->stats.avg_ms);
    if ( 1U == me->pstage )
    {
        if ( ping_ask(me, WF_PING_INTERNET) )
        {
            me->pstage = 2U;
        }
        else
        {
            me->internet.done = true;
            me->pstage        = 0U;
        }
    }
    else
    {
        me->pstage = 0U;
    }
    if ( page_ping == kit_current(&me->kit) )
    {
        kit_refresh(&me->kit);
    }
}

/* ---- Home ---- */

/** @brief A tap on Networks. @param e The event. */
static void home_scan_cb(lv_event_t *e)
{
    (void)e;
    scan_start(&s_ao);
    kit_push(&s_ao.kit, &page_scan, &s_ao);
}

/** @brief A tap on Status. @param e The event. */
static void home_status_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_status, &s_ao);
}

/** @brief A tap on Check connection. @param e The event. */
static void home_ping_cb(lv_event_t *e)
{
    (void)e;
    ping_start(&s_ao);
    kit_push(&s_ao.kit, &page_ping, &s_ao);
}

/**
 * @brief The first page: networks, status, and the check.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_home(kit_t *kit, void *arg)
{
    WifiKitAo * const me   = (WifiKitAo *)arg;
    lv_obj_t * const  body = kit_page(kit, "Wi-Fi");
    char              sub[48];
    char              ip[20];

    status_read(me);
    (void)kit_row(kit, body, "Networks", "Scan the air", &app_glyph_wifi_40, NULL, KUI_COLOR_ACTION, &home_scan_cb, me);
    if ( joined(me, NULL) )
    {
        ip_text(me->st.ip4, ip, sizeof(ip));
        (void)snprintf(sub, sizeof(sub), "%s", me->st.ssid);
        (void)kit_row(kit, body, "Connected", sub, &app_glyph_check_40, NULL, KUI_COLOR_OK, &home_status_cb, me);
    }
    else if ( KODE_SYS_WIFI_STATE_CONNECTING == me->st.state )
    {
        (void)kit_row(kit, body, "Connecting", me->st.ssid, &app_glyph_signal_40, NULL, KUI_COLOR_ACCENT,
                      &home_status_cb, me);
    }
    else
    {
        (void)kit_row(kit, body, "Status", "Not connected", &app_glyph_signal_40, NULL, KUI_COLOR_ACCENT,
                      &home_status_cb, me);
    }
    (void)kit_row(kit, body, "Check connection", "Router and internet", &app_glyph_bolt_40, NULL,
                  KUI_COLOR_ACCENT, &home_ping_cb, me);
}

/* ---- Networks ---- */

/** @brief A tap on a network. @param e The event. */
static void scan_pick_cb(lv_event_t *e)
{
    s_ao.sel = (uint8_t)(uintptr_t)lv_event_get_user_data(e);
    status_read(&s_ao);
    kit_push(&s_ao.kit, &page_net, &s_ao);
}

/** @brief Scan again. @param e The event. */
static void scan_again_cb(lv_event_t *e)
{
    (void)e;
    scan_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/** @brief Leave the page. @param e The event. */
static void scan_back_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief One network as a row: its security in the slot, its strength in bars.
 * @param kit  The kit.
 * @param body The column.
 * @param me   The Active Object.
 * @param i    The network.
 */
static void net_row(kit_t *kit, lv_obj_t *body, WifiKitAo *me, uint32_t i)
{
    wf_net_t const * const n = &me->nets[i];
    char                   sub[40];
    lv_obj_t              *row;

    if ( joined(me, n->ssid) && ('\0' != n->ssid[0]) )
    {
        (void)snprintf(sub, sizeof(sub), "Connected, ch %u", (unsigned)n->channel);
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "%s, ch %u", auth_short(n->auth), (unsigned)n->channel);
    }
    if ( 0U == n->auth )
    {
        row = kit_row(kit, body, net_title(n), sub, &app_glyph_wifi_40, NULL, KUI_COLOR_ACCENT, &scan_pick_cb,
                      (void *)(uintptr_t)i);
    }
    else
    {
        row = kit_row(kit, body, net_title(n), sub, &app_glyph_lock_40, NULL, KUI_COLOR_ACCENT, &scan_pick_cb,
                      (void *)(uintptr_t)i);
    }
    lv_obj_set_width(lv_obj_find_by_name(row, "name"), WF_NAME_W);
    lv_obj_set_width(lv_obj_find_by_name(row, "sub"), WF_NAME_W);
    draw_bars(row, bars_of(n->rssi), WF_BAR_X, 54);
}

/**
 * @brief The Networks page: waiting for the sweep, the list, or why there is none.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_scan(kit_t *kit, void *arg)
{
    WifiKitAo * const me = (WifiKitAo *)arg;
    lv_obj_t         *page;

    if ( WF_S_DONE == me->scan )
    {
        lv_obj_t * const body = kit_page(kit, "Networks");

        for ( uint32_t i = 0U; i < me->nnets; ++i )
        {
            net_row(kit, body, me, i);
        }
        (void)kit_row(kit, body, "Scan again", "Look once more", &app_glyph_refresh_40, NULL, KUI_COLOR_ACTION,
                      &scan_again_cb, me);
        return;
    }
    page = kit_page_bare(kit);
    kit_no_swipe(kit);
    switch ( me->scan )
    {
        case WF_S_EMPTY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wifi_96, "No networks found",
                            "Nothing is in range. Move closer to a router");
            foot_one(kit, page, "Scan again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case WF_S_BUSY:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wifi_96, "Radio is busy",
                            "Something else is using it. Try again in a moment");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case WF_S_TAKEN:
        {
            (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wifi_96, "Scan was interrupted",
                            "Another request took the radio");
            foot_one(kit, page, "Scan again", KIT_BTN_ACTION, &scan_again_cb);
            break;
        }
        case WF_S_OFF:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wifi_96, "Wi-Fi is not available",
                            "This Dot cannot use Wi-Fi right now");
            foot_one(kit, page, "Back", KIT_BTN_QUIET, &scan_back_cb);
            break;
        }
        case WF_S_SCANNING:
        case WF_S_IDLE:
        case WF_S_DONE:
        default:
        {
            lv_obj_t * const stage = kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wifi_96, "Looking for networks",
                                               "It takes about half a minute");

            (void)stage;
            foot_one(kit, page, "Cancel", KIT_BTN_QUIET, &scan_back_cb);
            break;
        }
    }
    kit_bar(kit, page, "Networks");
}

/* ---- One network ---- */

/** @brief The password was typed. @param user The Active Object. @param text The password. */
static void pass_done(void *user, const char *text)
{
    WifiKitAo * const me = (WifiKitAo *)user;

    (void)strncpy(me->pass, text, sizeof(me->pass) - 1U);
    me->pass[sizeof(me->pass) - 1U] = '\0';
    me->have_pass                   = true;
    join_start(me);
    kit_replace(&me->kit, &page_connect, me);
}

/** @brief Ask for the password of the target. @param me The Active Object. @param replace Replace the page on the glass. */
static void ask_pass(WifiKitAo *me, bool replace)
{
    me->name.done   = &pass_done;
    me->name.user   = me;
    me->name.max    = (uint8_t)WF_PASS_MAX;
    me->name.mode   = 1U;
    me->name.title  = "Password";
    me->name.answer = "Join";
    me->name.hint   = "Password";
    me->name.secret = true;
    me->name.reveal = false;
    (void)strncpy(me->name.text, me->pass, sizeof(me->name.text) - 1U);
    if ( replace )
    {
        kit_replace(&me->kit, &kit_name_page, &me->name);
    }
    else
    {
        kit_push(&me->kit, &kit_name_page, &me->name);
    }
}

/** @brief The hidden network's name was typed. @param user The Active Object. @param text The name. */
static void hidden_done(void *user, const char *text)
{
    WifiKitAo * const me = (WifiKitAo *)user;

    (void)strncpy(me->target, text, sizeof(me->target) - 1U);
    me->target[sizeof(me->target) - 1U] = '\0';
    me->pass[0]                         = '\0';
    ask_pass(me, true);
}

/** @brief A tap on Connect. @param e The event. */
static void net_connect_cb(lv_event_t *e)
{
    WifiKitAo * const me = &s_ao;
    wf_net_t const   *n;

    (void)e;
    if ( me->sel >= me->nnets )
    {
        return;
    }
    n = &me->nets[me->sel];
    me->pass[0] = '\0';
    if ( '\0' == n->ssid[0] )
    {
        me->name.done   = &hidden_done;
        me->name.user   = me;
        me->name.max    = (uint8_t)WF_SSID_MAX;
        me->name.mode   = 0U;
        me->name.title  = "Network name";
        me->name.answer = "Next";
        me->name.hint   = "Network name";
        me->name.secret = false;
        me->name.text[0] = '\0';
        kit_push(&me->kit, &kit_name_page, &me->name);
        return;
    }
    (void)strncpy(me->target, n->ssid, sizeof(me->target) - 1U);
    me->target[sizeof(me->target) - 1U] = '\0';
    if ( 0U == n->auth )
    {
        me->have_pass = false;
        join_start(me);
        kit_push(&me->kit, &page_connect, me);
    }
    else
    {
        ask_pass(me, false);
    }
}

/** @brief A tap on Disconnect. @param e The event. */
static void disconnect_cb(lv_event_t *e)
{
    (void)e;
    (void)kode_sys_wifi_disconnect();
    (void)kit_back(&s_ao.kit);
}

/** @brief A tap on Status from a network page. @param e The event. */
static void net_status_cb(lv_event_t *e)
{
    (void)e;
    kit_push(&s_ao.kit, &page_status, &s_ao);
}

/**
 * @brief One line of a details page: a small caption and a value under it.
 * @param page    The page.
 * @param y       Where.
 * @param caption The small words.
 * @param value   The big words.
 */
static void detail(lv_obj_t *page, int32_t y, char const *caption, char const *value)
{
    lv_obj_t *l;

    l = kit_text(page, caption, &kui_font_caption, KUI_COLOR_TEXT_MUTED, KIT_ROW_W, false);
    lv_obj_set_pos(l, KIT_SIDE, y);
    l = kit_text(page, value, &kui_font_name, KUI_COLOR_TEXT_ON_BG, KIT_ROW_W - 50, false);
    lv_obj_set_pos(l, KIT_SIDE, y + 26);
}

/**
 * @brief A network: what is known of it, and Connect.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_net(kit_t *kit, void *arg)
{
    WifiKitAo * const me = (WifiKitAo *)arg;
    lv_obj_t         *page;
    wf_net_t const   *n;
    char              line[48];

    if ( me->sel >= me->nnets )
    {
        (void)kit_back(kit);
        return;
    }
    n    = &me->nets[me->sel];
    page = kit_page_bare(kit);
    detail(page, 74, "Security", auth_name(n->auth));
    (void)snprintf(line, sizeof(line), "%u, %s GHz", (unsigned)n->channel, (WF_CHANNEL_5G < n->channel) ? "5" : "2.4");
    detail(page, 148, "Channel", line);
    (void)snprintf(line, sizeof(line), "%s, %d dBm", strength_word(n->rssi), (int)n->rssi);
    detail(page, 222, "Signal", line);
    draw_bars(page, bars_of(n->rssi), 330, 262);
    if ( joined(me, n->ssid) && ('\0' != n->ssid[0]) )
    {
        foot_two(kit, page, "Status", KIT_BTN_QUIET, &net_status_cb, "Disconnect", KIT_BTN_DANGER, &disconnect_cb);
    }
    else
    {
        foot_one(kit, page, "Connect", KIT_BTN_ACTION, &net_connect_cb);
    }
    kit_bar(kit, page, net_title(n));
}

/* ---- Connecting ---- */

/** @brief Try the join again. @param e The event. */
static void conn_again_cb(lv_event_t *e)
{
    WifiKitAo * const me = &s_ao;

    (void)e;
    if ( me->have_pass && (WF_C_PASSWORD == me->conn) )
    {
        ask_pass(me, true);
    }
    else
    {
        join_start(me);
        kit_refresh(&me->kit);
    }
}

/** @brief Cancel a join. @param e The event. */
static void conn_cancel_cb(lv_event_t *e)
{
    (void)e;
    (void)kode_sys_wifi_disconnect();
    s_ao.conn = WF_C_REFUSED;
    (void)kit_back(&s_ao.kit);
}

/** @brief Joined: show the status. @param e The event. */
static void conn_done_cb(lv_event_t *e)
{
    (void)e;
    status_read(&s_ao);
    kit_home(&s_ao.kit);
    kit_push(&s_ao.kit, &page_status, &s_ao);
}

/** @brief Back out of a failed join. @param e The event. */
static void conn_back_cb(lv_event_t *e)
{
    (void)e;
    (void)kit_back(&s_ao.kit);
}

/**
 * @brief The Connect page: joining, joined, or why not.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_connect(kit_t *kit, void *arg)
{
    WifiKitAo * const me   = (WifiKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              line[64];
    char              ip[20];

    kit_no_swipe(kit);
    switch ( me->conn )
    {
        case WF_C_JOINING:
        {
            (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wifi_96, "Connecting", me->target);
            foot_one(kit, page, "Cancel", KIT_BTN_QUIET, &conn_cancel_cb);
            break;
        }
        case WF_C_OK:
        {
            status_read(me);
            ip_text(me->st.ip4, ip, sizeof(ip));
            (void)snprintf(line, sizeof(line), "%s\n%s", me->target, ip);
            (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_check_96, "Connected", line);
            foot_one(kit, page, "Done", KIT_BTN_ACTION, &conn_done_cb);
            break;
        }
        case WF_C_PASSWORD:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_lock_96, "Wrong password",
                            "The network did not accept it. Check it and try again");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &conn_again_cb);
            break;
        }
        case WF_C_NOTFOUND:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wifi_96, "Network not found",
                            "It may be out of range or switched off");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &conn_again_cb);
            break;
        }
        case WF_C_REFUSED:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wifi_96, "Could not start",
                            "Wi-Fi is not available right now");
            foot_one(kit, page, "Back", KIT_BTN_QUIET, &conn_back_cb);
            break;
        }
        case WF_C_OTHER:
        default:
        {
            (void)kit_stage(kit, page, KUI_COLOR_DANGER, &app_glyph_wifi_96, "Could not connect",
                            "The network gave the Dot no address. Try again");
            foot_one(kit, page, "Try again", KIT_BTN_ACTION, &conn_again_cb);
            break;
        }
    }
}

/* ---- Status ---- */

/** @brief A tap on Find networks. @param e The event. */
static void status_find_cb(lv_event_t *e)
{
    (void)e;
    scan_start(&s_ao);
    kit_push(&s_ao.kit, &page_scan, &s_ao);
}

/** @brief A tap on Check. @param e The event. */
static void status_check_cb(lv_event_t *e)
{
    (void)e;
    ping_start(&s_ao);
    kit_push(&s_ao.kit, &page_ping, &s_ao);
}

/** @brief A tap on Disconnect from the status page. @param e The event. */
static void status_disconnect_cb(lv_event_t *e)
{
    (void)e;
    (void)kode_sys_wifi_disconnect();
}

/**
 * @brief Where the connection stands.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_status(kit_t *kit, void *arg)
{
    WifiKitAo * const me   = (WifiKitAo *)arg;
    lv_obj_t * const  page = kit_page_bare(kit);
    char              line[80];
    char              ip[20];

    status_read(me);
    if ( joined(me, NULL) )
    {
        ip_text(me->st.ip4, ip, sizeof(ip));
        if ( 0 != me->rssi )
        {
            (void)snprintf(line, sizeof(line), "%s\n%s, %d dBm", ip, strength_word(me->rssi), (int)me->rssi);
        }
        else
        {
            (void)snprintf(line, sizeof(line), "%s", ip);
        }
        (void)kit_stage(kit, page, KUI_COLOR_OK, &app_glyph_wifi_96, me->st.ssid, line);
        foot_two(kit, page, "Check", KIT_BTN_QUIET, &status_check_cb, "Disconnect", KIT_BTN_DANGER,
                 &status_disconnect_cb);
    }
    else if ( KODE_SYS_WIFI_STATE_CONNECTING == me->st.state )
    {
        (void)kit_stage(kit, page, KUI_COLOR_ACCENT, &app_glyph_wifi_96, "Connecting", me->st.ssid);
        foot_one(kit, page, "Find networks", KIT_BTN_QUIET, &status_find_cb);
    }
    else
    {
        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wifi_96, "Not connected",
                        "Scan for a network to join one");
        foot_one(kit, page, "Find networks", KIT_BTN_ACTION, &status_find_cb);
    }
    kit_bar(kit, page, "Status");
}

/* ---- The check ---- */

/** @brief Run the check again. @param e The event. */
static void ping_again_cb(lv_event_t *e)
{
    (void)e;
    ping_start(&s_ao);
    kit_refresh(&s_ao.kit);
}

/**
 * @brief One target of the check as a row.
 * @param kit  The kit.
 * @param body The column.
 * @param name The target.
 * @param p    Its result.
 */
static void ping_row(kit_t *kit, lv_obj_t *body, char const *name, wf_ping_t const *p)
{
    char                  sub[48];
    lv_obj_t             *row;
    const lv_image_dsc_t *glyph = &app_glyph_refresh_40;
    lv_color_t            colour = KUI_COLOR_ACCENT;

    if ( !p->done )
    {
        (void)snprintf(sub, sizeof(sub), "Checking");
    }
    else if ( !p->ran )
    {
        (void)snprintf(sub, sizeof(sub), "Could not check");
        glyph  = &app_glyph_stop_40;
        colour = KUI_COLOR_DANGER;
    }
    else if ( 0U == p->rx )
    {
        (void)snprintf(sub, sizeof(sub), "No reply");
        glyph  = &app_glyph_stop_40;
        colour = KUI_COLOR_DANGER;
    }
    else
    {
        (void)snprintf(sub, sizeof(sub), "%u of %u replies, %u ms", (unsigned)p->rx, (unsigned)p->tx,
                       (unsigned)p->avg_ms);
        glyph  = &app_glyph_check_40;
        colour = KUI_COLOR_OK;
        if ( p->rx < p->tx )
        {
            colour = KUI_COLOR_ACTION;
        }
    }
    row = kit_row(kit, body, name, sub, glyph, NULL, colour, NULL, NULL);
    (void)row;
}

/**
 * @brief The connection check: the router, then the internet.
 * @param kit The kit.
 * @param arg The Active Object.
 */
static void page_ping(kit_t *kit, void *arg)
{
    WifiKitAo * const me = (WifiKitAo *)arg;

    if ( !joined(me, NULL) && (0U == me->pstage) && !me->router.done )
    {
        lv_obj_t * const page = kit_page_bare(kit);

        (void)kit_stage(kit, page, KUI_COLOR_TEXT_MUTED, &app_glyph_wifi_96, "Not connected",
                        "Join a network to check it");
        foot_one(kit, page, "Find networks", KIT_BTN_ACTION, &status_find_cb);
        kit_bar(kit, page, "Check connection");
        return;
    }
    {
        lv_obj_t * const body = kit_page(kit, "Check connection");
        lv_obj_t * const page = lv_obj_get_parent(body);

        ping_row(kit, body, "Router", &me->router);
        ping_row(kit, body, "Internet", &me->internet);
        if ( (me->router.done && me->internet.done) )
        {
            foot_one(kit, page, "Again", KIT_BTN_ACTION, &ping_again_cb);
        }
    }
}

/* ---- The Active Object ---- */

void WifiKitAo_ctor(void)
{
    WifiKitAo * const me = &s_ao;

    QActive_ctor(&me->super, Q_STATE_CAST(&WifiKitAo_initial));
    kit_ctor(&me->kit, &me->super, (enum_t)WIFIKIT_TICK_SIG);
}

void WifiKitAo_start(void)
{
    QActive_setAttr(AO_WifiKit, TASK_NAME_ATTR, "wifi_kit_ao");
    QACTIVE_START(AO_WifiKit, KODE_PRIO_USER_GUI, s_queue, Q_DIM(s_queue), s_stack, sizeof(s_stack), (void *)0);
}

/**
 * @brief The initial transition: subscribe to the radio's news, ask for the panel, then run.
 * @param me  The Active Object.
 * @param par Unused.
 * @return The transition to WifiKitAo_running.
 */
static QState WifiKitAo_initial(WifiKitAo * const me, void const * const par)
{
    (void)par;
    kit_start(&me->kit);
    QActive_subscribe(&me->super, WIFI_STATE_SIG);
    QActive_subscribe(&me->super, NET_INFO_SIG);
    KLOG_I(TAG, "up");
    return Q_TRAN(&WifiKitAo_running);
}

/**
 * @brief The one state.
 * @param me The Active Object.
 * @param e  The event.
 * @return Q_HANDLED() for what it handles, Q_SUPER() otherwise.
 */
static QState WifiKitAo_running(WifiKitAo * const me, QEvt const * const e)
{
    QState status = Q_HANDLED();

    switch ( e->sig )
    {
        case DISPLAY_STATE_SIG:
        {
            if ( kit_open_glass(&me->kit, Q_EVT_CAST(DisplayStateEvt)) && (0U == kit_depth(&me->kit)) )
            {
                kit_push(&me->kit, &page_home, me);
            }
            break;
        }
        case WIFI_STATE_SIG:
        {
            wifi_state(me, Q_EVT_CAST(WifiStateEvt));
            break;
        }
        case NET_INFO_SIG:
        {
            me->gw4 = Q_EVT_CAST(NetInfoEvt)->gw4;
            break;
        }
        case WIFI_SCAN_ENTRY_SIG:
        {
            scan_entry(me, Q_EVT_CAST(kode_sys_wifi_scan_entry_t));
            break;
        }
        case WIFI_SCAN_RSP_SIG:
        {
            scan_end(me, Q_EVT_CAST(kode_sys_wifi_scan_answer_t));
            break;
        }
        case NET_PING_RSP_SIG:
        {
            ping_end(me, Q_EVT_CAST(kode_sys_net_answer_t));
            break;
        }
        default:
        {
            if ( !kit_on_event(&me->kit, e) )
            {
                status = Q_SUPER(&QHsm_top);
            }
            break;
        }
    }
    return status;
}
