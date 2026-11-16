/* SPDX-License-Identifier: GPL-3.0-or-later
 * esp-hosted's internal RPC types, only as far as kdrv_radio_rpc.c names them. It wraps rpc_send_req() and
 * rpc_wait_and_parse_sync_resp() at link time; with no esp-hosted here nothing calls the wrappers, and the
 * "real" functions (radio_hosted.c) are inert. */
#ifndef DOTBENCH_RPC_SLAVE_IF_H
#define DOTBENCH_RPC_SLAVE_IF_H
#include <stdint.h>
typedef struct ctrl_cmd_t ctrl_cmd_t;
typedef int (*ctrl_resp_cb_t)(ctrl_cmd_t *resp);
struct ctrl_cmd_t {
    uint32_t msg_id;
    uint32_t uid;
    int      resp_timeout_ms;
    ctrl_resp_cb_t rpc_rsp_cb;
    int      resp_status;
};
#endif
