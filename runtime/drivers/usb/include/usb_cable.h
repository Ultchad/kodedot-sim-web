/* SPDX-License-Identifier: GPL-3.0-or-later
 * The USB-C cable's data side (runtime/drivers/usb/usb_cable.c), as the console transport sees it: what usb_serial_jtag_read_bytes /
 * usb_serial_jtag_write_bytes are on the board. */
#ifndef DOTBENCH_USB_CABLE_H
#define DOTBENCH_USB_CABLE_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
/* A computer is on the other end and has the serial port open (cable plugged AND host attached). */
bool usb_cable_up(void);
/* Dot -> computer. A chunk goes in whole or not at all (as usb_serial_jtag_write_bytes). Returns len, or 0 when it was not taken:
 * no computer, or the TX ring stayed full for wait_ms. After one timed-out wait every later chunk is tried without waiting
 * until one fits (the board's "nobody is reading" rule). */
size_t usb_cable_write(const void *buf, size_t len, uint32_t wait_ms);
/* Computer -> Dot: bytes the host sent, waiting up to timeout_ms for the first. */
int32_t usb_cable_read(void *buf, size_t want, uint32_t timeout_ms);
#endif
