"""Which source files make up the dotbench SDK library, and with which flags.

This mirrors the CMakeLists.txt of every kode-sdk component (read them side by
side), evaluated against the sdkconfig produced by gen_sdkconfig.py. Where the
web build replaces a file, REPLACED says which and why; docs/STATUS-foundation.md
repeats the list for humans.
"""
import pathlib

# Source files of the SDK that are NOT compiled, because runtime/drivers (or a
# generated stub) provides the functions instead. path relative to the SDK root.
# value = reason (copied into STATUS).
REPLACED = {
    "components/khal/system/src/khal_system_esp.c": "web fake: runtime/drivers/system",
    "components/khal/console/src/khal_console_esp.c": "web fake: runtime/drivers/console (USB-CDC console -> bridge ring)",
    "components/khal/gpio/src/khal_gpio_esp.c": "web fake: runtime/drivers/gpio (GPIO35 button, expander INT line)",
    "components/khal/i2c/src/khal_i2c_esp.c": "web fake: runtime/drivers/i2c (virtual TCA6408A, KTD2026, CST820)",
    "components/khal/nvs/src/khal_nvs_esp.c": "web fake: runtime/drivers/nvs (in-memory key-value store)",
    "components/khal/clk/src/khal_clk_esp.c": "stubbed: clock tree readout, no meaning in a browser",
    "components/khal/exp/src/khal_exp_esp.c": "stubbed: J3 expansion pins (stage 5)",
    "components/khal/keep/src/khal_keep_esp.c": "stubbed: RTC-RAM survives-reset store",
    "components/khal/power/src/khal_power_esp.c": "stubbed: light sleep / power management",
    "components/khal/sdmmc/src/khal_sdmmc_esp.c": "stubbed: microSD controller (stage 4)",
    "components/khal/temp/src/khal_temp_esp.c": "stubbed: die temperature sensor",
    "components/khal/zlib/src/khal_zlib_esp.c": "stubbed: needs ESP ROM miniz",
    "components/khal/pwm/src/khal_pwm_esp.c": "stubbed: LEDC peripheral",
    "components/kdrv/display/src/kdrv_display.c": "web fake: runtime/drivers/display (esp_lcd DSI panel -> kweb_state framebuffer)",
    "components/kdrv/audio/src/kdrv_es8311.c": "stubbed: I2S codec (stage 4)",
    "components/kdrv/nfc/src/kdrv_st25r3916.c": "stubbed: ST25R3916B NFC front end (stage 2)",
    "components/kdrv/rfid/src/kdrv_rfid_lf.c": "stubbed: 125 kHz front end (stage 2)",
    "components/kdrv/exp_bus/src/kdrv_exp_bus.c": "stubbed: J3 buses (stage 5)",
    "components/kdrv/apps/src/kdrv_slot.c": "stubbed: OTA slot flash region",
    "components/kdrv/apps/src/kdrv_slot_crash.c": "stubbed: crash record in flash",
    "components/kdrv/storage/src/kdrv_fs.c": "stubbed: FATFS (stage 1 files / stage 4 microSD)",
    "components/kdrv/apps/src/kdrv_apps.c": "stubbed: reads/writes the apps flash region and verifies ESP images",
    "components/kdrv/apps/src/kdrv_kfw.c": "stubbed: firmware image verification (mbedTLS PSA)",
    "components/kdrv/apps/src/kdrv_image_check.c": "stubbed: ESP image verification",
    "components/kui/pack/src/kui_pack.c": "not compiled: needs cJSON, which is not available offline; nothing the examples reference",
}


def _g(sdk, pattern):
    return sorted(str(p.relative_to(sdk)) for p in sdk.glob(pattern))


def sdk_sources(sdk, cfg):
    """Return {component: [relative source paths]} for the given config dict."""
    sdk = pathlib.Path(sdk)
    on = lambda k: cfg.get(k) == "y"
    c = "components/"
    out = {}

    out["qpc"] = [c + "qpc/port/qf_port.c"] + [
        c + "qpc/qpc/src/qf/" + f for f in (
            "qep_hsm.c", "qep_msm.c", "qf_act.c", "qf_defer.c", "qf_dyn.c", "qf_mem.c",
            "qf_ps.c", "qf_qact.c", "qf_qeq.c", "qf_qmact.c", "qf_time.c")]

    kqp = ["kqp.c", "kqp_isr.c", "kqp_self.c", "kqp_timer.c", "kqp_worker.c", "kqp_bsp.c", "kqp_tick.c"]
    if on("KQP_AO_WATCH"):
        kqp += ["kqp_watch_judge.c", "kqp_watch.c"]
    out["kqp"] = [c + "kqp/src/" + f for f in kqp]
    out["klog"] = [c + "klog/src/klog.c"]
    out["kbsp"] = [c + "kbsp/owners/src/kbsp_owners.c", c + "kbsp/exp/src/kbsp_exp.c",
                   c + "kbsp/exp/src/kbsp_station.c"]

    # ---- khal: real files (hardware-independent) --------------------------
    out["khal"] = [c + "khal/" + f for f in (
        "crc32/src/khal_crc32_esp.c", "exp/src/khal_exp.c", "identity/src/khal_identity_esp.c",
        "pwm/src/khal_pwm.c", "sync/src/khal_once.c", "sync/src/khal_sync_esp.c",
        "time/src/khal_time_esp.c", "time/src/khal_time_zone.c", "worker/src/khal_worker_esp.c")]

    # ---- kaos ---------------------------------------------------------------
    k = ["core/src/kaos_claim.c", "core/src/kaos_park.c", "core/src/kaos_linked.c", "core/src/kaos_ask.c",
         "log/src/log_ao.c", "storage/src/storage_ao.c", "boot/src/boot_ao.c", "boot/src/boot_zone.c",
         "led/src/led_mgr.c", "ioexp/src/ioexp_ao.c", "buttons/src/buttons_ao.c", "ir/src/ir_ao.c",
         "rfid/src/rfid_ao.c", "audio/src/audio_ao.c", "imu/src/imu_ao.c", "haptic/src/haptic_ao.c",
         "power/src/power_ao.c", "display/src/display_ao.c", "display/src/display_sleep.c",
         "touch/src/touch_ao.c", "touch/src/touch_record.c", "core/src/kregistry.c", "core/src/kode_config.c"]
    if on("KODEOS_APPMGR"):
        k += ["appmgr/src/appmgr_ao.c", "appmgr/src/appmgr_backup.c", "appmgr/src/appmgr_outcome.c"]
    if on("KODEOS_NFC"):
        k += ["nfc/src/nfc_ao.c"] + (["nfc/src/nfc_verbs.c"] if on("KODEOS_CONSOLE") else [])
    if on("KODE_LOWPOWER"):
        k += ["lowpower/src/lowpower_ao.c", "lowpower/src/lowpower_last.c", "display/src/display_clock.c"]
    else:
        k += ["lowpower/src/lowpower_none.c"]
    k += ["display/src/display_compose.c"] if on("KODE_COMPOSE") else ["display/src/display_compose_none.c"]
    if on("KODE_SCHEDULER"):
        k += ["scheduler/src/scheduler_ao.c", "scheduler/src/sched_cron.c"]
    else:
        k += ["scheduler/src/scheduler_none.c"]
    if on("KODEOS_AUTOTEST"):
        k += ["autotest/src/autotest_ao.c", "autotest/src/autotest_psram.c", "core/src/krows.c"]
    if on("KODEOS_CONSOLE"):
        k += ["console/src/console_ao.c", "console/src/console_fs.c", "console/src/console_grammar.c",
              "core/src/kverbs.c", "led/src/led_verbs.c", "touch/src/touch_verbs.c", "audio/src/audio_verbs.c",
              "haptic/src/haptic_verbs.c", "ir/src/ir_verbs.c", "rfid/src/rfid_verbs.c",
              "display/src/display_verbs.c", "storage/src/storage_verbs.c"]
        if on("KODEOS_APPMGR"):
            k += ["appmgr/src/appmgr_verbs.c"]
        if on("KODE_LOWPOWER"):
            k += ["lowpower/src/lowpower_verbs.c"]
        if on("KODE_SCHEDULER"):
            k += ["scheduler/src/scheduler_verbs.c"]
    if on("KODEOS_RADIO"):
        k += ["radio/src/radio_ao.c", "radio/src/radio_frames.c", "radio/src/radio_knock.c", "radio/src/radio_knocks.c"]
        if on("KODEOS_BLE"):
            k += ["radio/src/radio_heard.c"]
        if on("KODEOS_CONSOLE"):
            k += ["radio/src/radio_verbs.c"]
        if on("KODEOS_WIFI") and on("KODEOS_NET"):
            k += ["net/src/net_ao.c", "storage/src/storage_fetch.c", "net/src/net_channel.c"]
            if on("KODEOS_CONSOLE"):
                k += ["net/src/net_verbs.c"]
    out["kaos"] = [c + "kaos/" + f for f in k]

    # ---- kdrv ---------------------------------------------------------------
    d = ["led/src/kdrv_led.c", "clocks/src/kdrv_clocks.c", "tca6408a/src/kdrv_tca6408a.c",
         "display/src/kdrv_display.c", "cst820/src/kdrv_cst820.c", "buttons/src/kdrv_buttons.c",
         "exp_bus/src/kdrv_exp_bus.c", "ir/src/kdrv_ir.c", "ir/src/knec.c",
         "nfc/src/kdrv_st25r3916.c", "nfc/src/knfc_crypto1.c", "nfc/src/knfc_emu_img.c", "nfc/src/knfc_field.c",
         "nfc/src/knfc_mfc.c", "nfc/src/knfc_mfc_dict.c", "nfc/src/knfc_ndef.c", "nfc/src/knfc_power.c",
         "nfc/src/knfc_ident.c", "nfc/src/knfc_tag.c",
         "audio/src/kdrv_es8311.c", "audio/src/kes_fields.c", "audio/src/kring.c", "audio/src/ktone.c",
         "audio/src/kwav.c",
         "motion/src/kimu_energy.c", "motion/src/kcompass.c", "motion/src/kdrv_qmi8658.c",
         "motion/src/kdrv_qmc5883p.c", "motion/src/kdrv_aw86233.c",
         "power/src/kdrv_bq25896.c", "power/src/kdrv_cw2217.c",
         "storage/src/kdrv_storage.c", "storage/src/kdrv_sd.c", "storage/src/kdrv_fs.c",
         "apps/src/kdrv_slot.c", "apps/src/kdrv_slot_crash.c", "apps/src/kdrv_apps.c", "apps/src/kdrv_kfw.c",
         "apps/src/kdrv_image_check.c", "apps/src/kapp_desc.c", "apps/src/kapp_cat.c", "apps/src/kapp_data.c",
         "rfid/src/krfid_em4100.c", "rfid/src/krfid_env.c", "rfid/src/krfid_mod.c", "rfid/src/krfid_wave.c",
         "rfid/src/kdrv_rfid_lf.c"]
    if on("KODEOS_MIRROR") or on("KODE_COMPOSE"):
        d += ["compose/src/kdrv_compose.c", "compose/src/kdrv_compose_check.c"]
    if on("KODEOS_MIRROR"):
        d += ["mirror/src/kdrv_jpeg.c", "mirror/src/kdrv_ppa.c", "mirror/src/kmirror_proto.c"]
    if on("KODEOS_RADIO"):
        d += ["radio/src/kdrv_radio.c", "radio/src/kdrv_radio_rpc.c", "radio/src/kdrv_radio_note.c",
              "radio/src/kdrv_c5.c", "radio/src/kdrv_c5svc.c", "radio/src/kdrv_frames.c"]
        if on("KODE_LOWPOWER"):
            d += ["radio/src/kdrv_radio_sleep_policy.c", "radio/src/kdrv_radio_sleep.c"]
        if on("KODEOS_WIFI"):
            d += ["radio/src/kdrv_wifi.c"] + (["radio/src/kdrv_net.c"] if on("KODEOS_NET") else [])
        if on("KODEOS_BLE"):
            d += ["radio/src/kdrv_ble.c", "radio/src/kdrv_ble_tokens.c", "radio/src/kdrv_ble_bonds.c",
                  "radio/src/kdrv_ble_adv.c", "radio/src/kdrv_ble_heard.c", "radio/src/kdrv_ble_app.c",
                  "radio/src/kdrv_ble_find.c"]
    else:
        d += ["radio/src/kdrv_c5_hold.c"]
    if on("KODE_TEST_DOT"):
        d += ["ov5640/src/kdrv_ov5640.c", "station/src/kdrv_station_i2c.c", "station/src/kdrv_pcf8574.c",
              "station/src/kdrv_ads1115.c", "station/src/kdrv_dock_loop.c"]
    out["kdrv"] = [c + "kdrv/" + f for f in d]

    # ---- the facade layers ----------------------------------------------------
    ks = ["kode_sys.c", "kode_sys_time.c", "kode_sys_led.c", "kode_sys_display.c", "kode_sys_buttons.c",
          "kode_sys_ir.c", "kode_sys_audio.c", "kode_sys_haptic.c", "kode_sys_imu.c", "kode_sys_rfid.c",
          "kode_sys_nvs.c", "kode_sys_files.c", "kode_sys_flash.c", "kode_sys_net.c", "kode_sys_http_file.c",
          "kode_sys_mqtt.c", "kode_sys_wifi.c", "kode_sys_wifi_status.c", "kode_sys_wifi_scan.c",
          "kode_sys_wifi_frames.c", "kode_sys_scan.c", "kode_sys_ble.c", "kode_sys_ble_heard.c",
          "kode_sys_power.c", "kode_sys_exp.c", "kode_sys_exp_power.c", "kode_sys_home.c", "kode_sys_touch.c",
          "kode_sys_console.c", "kode_gate.c", "kode_cert_rfid.c", "kode_banner.c", "kode_banner_text.c"]
    if on("KODEOS_NFC"):
        ks += ["kode_sys_nfc.c", "kode_cert_nfc.c"]
    out["kode_sys"] = [c + "kode_sys/src/" + f for f in ks]

    kd = ["kode_audio", "kode_battery", "kode_bus", "kode_button", "kode_entry", "kode_event", "kode_file",
          "kode_haptic", "kode_http", "kode_ir", "kode_ir_capture", "kode_ir_file", "kode_led", "kode_motion",
          "kode_mqtt", "kode_net", "kode_pin", "kode_pin_power", "kode_rfid", "kode_screen_bright",
          "kode_screen_sleep", "kode_setting", "kode_standard_ao", "kode_system", "kode_tag", "kode_touch",
          "kode_wifi", "kode_ble"]
    if on("KODEOS_NFC"):
        kd.append("kode_nfc")
    out["kode"] = [c + "kode/src/%s.c" % f for f in kd]
    out["kode_screen"] = [c + "kode_screen/src/" + f for f in (
        "kode_widget.c", "kode_canvas.c", "kode_png.c", "kode_compass.c", "kode_screen.c")]
    out["kscreen"] = [c + "kscreen/src/" + f for f in ("kscreen.c", "kscreen_compose.c", "kscreen_geom.c")]

    # ---- kui: everything under core/drag/glass/panel/kody/multitap/fonts/images ----
    kui = []
    for sub in ("core", "drag", "glass", "panel", "multitap", "fonts", "images"):
        kui += _g(sdk, c + "kui/%s/src/*.c" % sub)
    kui += [c + "kui/kody/src/kui_kody.c", c + "kui/kody/src/kui_kody_anchor.c"]
    if on("LV_USE_LOTTIE"):
        kui += [c + "kui/kody/src/kody_reloj.c", c + "kui/kody/src/kody_despierta_reloj.c",
                c + "kui/kody/src/kody_reloj_te_mira.c"]
    out["kui"] = kui
    return out


def apply_replaced(files):
    return [f for f in files if f not in REPLACED]


# Include directories (public ones of every component, as ESP-IDF would export them),
# relative to the SDK root. Private "src" dirs are added for the component that owns them.
PUBLIC_INCLUDES = [
    "components/kdefs/include", "components/klog/include",
    "components/kbsp/board/include", "components/kbsp/exp/include", "components/kbsp/owners/include",
    "components/kaos/core/include", "components/kqp/include",
    "components/kode_sys/include", "components/kode_sys/internal/include",
    "components/kode/include", "components/kode/internal/include",
    "components/kscreen/include",
    "components/qpc/qpc/include", "components/qpc/port",
]
PUBLIC_GLOBS = [
    "components/khal/*/include", "components/kdrv/*/include", "components/kui/*/include",
]
# private include dirs (src directories) per component
PRIVATE_GLOBS = {
    "kaos": ["components/kaos/*/src"],
    "kdrv": ["components/kdrv/*/src"],
    "kode": ["components/kode/src"],
    "kode_sys": ["components/kode_sys/src"],
    "kode_screen": ["components/kode_screen/src"],
    "kscreen": ["components/kscreen/src"],
    "kui": ["components/kui/core/src"],
    "kqp": ["components/kqp/src"],
    "khal": ["components/khal/*/src"],
}


# ---- LVGL ----------------------------------------------------------------------
# LVGL is compiled whole (every file guards itself with its LV_USE_* switch) except
# the directories that are platform glue for other targets.
LVGL_EXCLUDE_DIRS = (
    "src/drivers",              # display/touch/OS drivers for other platforms
    "src/draw/nxp", "src/draw/renesas", "src/draw/dma2d", "src/draw/vg_lite", "src/draw/eve",
    "src/draw/opengles", "src/draw/nema_gfx", "src/draw/espressif", "src/draw/sdl", "src/draw/arm2d",
    "src/draw/convert/helium", "src/draw/sw/blend/neon", "src/draw/sw/blend/helium",
    "src/draw/sw/blend/riscv_v", "src/draw/sw/blend/arm2d",
    "src/libs/freetype", "src/libs/rlottie", "src/libs/ffmpeg", "src/libs/gstreamer",
    "src/libs/libpng", "src/libs/libjpeg_turbo", "src/libs/libwebp", "src/libs/gltf",
    "src/libs/nanovg", "src/libs/vg_lite_driver", "src/libs/FT800-FT813",
    "src/draw/nanovg", "src/draw/sifli",
)


def lvgl_sources(lvgl, cfg):
    lvgl = pathlib.Path(lvgl)
    out = []
    for p in sorted((lvgl / "src").rglob("*.c")):
        rel = p.relative_to(lvgl).as_posix()
        if any(rel.startswith(d + "/") for d in LVGL_EXCLUDE_DIRS):
            continue
        out.append(rel)
    # the OS abstraction: only the "none" flavour, since the device's LVGL runs without one
    keep_os = "src/osal/lv_os_none.c"
    out = [f for f in out if not f.startswith("src/osal/") or f == keep_os or f == "src/osal/lv_os.c"]
    return out


def runtime_sources(root):
    """The dotbench runtime's own C files (relative to the repo root)."""
    root = pathlib.Path(root)
    out = ["runtime/rtos/src/rtos.c", "runtime/idf/src/idf.c", "runtime/bridge/kweb_bridge.c",
           "runtime/main/dotbench_main.c"]
    for d in sorted((root / "runtime/drivers").iterdir()):
        if d.is_dir() and not d.name.startswith("_"):
            out += [p.relative_to(root).as_posix() for p in sorted(d.glob("*.c"))]
    return out
