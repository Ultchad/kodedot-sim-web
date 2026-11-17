// dotbench component ABI 1. Everything a component asks of the bench
// goes through these imports, module name "dotbench". The bench calls back
// through the dp_* exports at the bottom of dotcore.cpp.
#pragma once
#include <stdint.h>
#include <stddef.h>

#define DP_IMPORT(n) __attribute__((import_module("dotbench"), import_name(#n)))
#define DP_EXPORT(n) __attribute__((export_name(#n), used))

extern "C" {
// time: virtual microseconds since the bench clock started
DP_IMPORT(time_us)        uint64_t dp_time_us(void);
// block (without spinning) until virtual time >= deadline; services bench events meanwhile
DP_IMPORT(wait_until_us)  void     dp_wait_until_us(uint64_t deadline_us);
// service pending bench events (slave transactions, pin edges, rx bytes), never blocks
DP_IMPORT(yield)          void     dp_yield(void);

// GPIO. mode: 0 INPUT 1 OUTPUT 2 INPUT_PULLUP 3 INPUT_PULLDOWN 4 OUTPUT_OPENDRAIN
DP_IMPORT(pin_mode)       void     dp_pin_mode(int pin, int mode);
DP_IMPORT(pin_write)      void     dp_pin_write(int pin, int level);
DP_IMPORT(pin_read)       int      dp_pin_read(int pin);
// irq kind: 0 none 2 CHANGE 3 FALLING 4 RISING (Arduino PinStatus values)
DP_IMPORT(pin_irq)        void     dp_pin_irq(int pin, int kind);
// PWM as a property of the net: frequency in Hz, duty in 1/65536 (0..65536)
DP_IMPORT(pwm)            void     dp_pwm(int pin, uint32_t hz, uint32_t duty_q16);
// analog: millivolts on the pin (0..3300); dac_mv puts an analog source on the pin (dacWrite)
DP_IMPORT(adc_mv)         int      dp_adc_mv(int pin);
DP_IMPORT(dac_mv)         void     dp_dac_mv(int pin, int mv);

// UART. port 0 is the console (shown in the component's Serial pane), 1 and 2 go to pins
DP_IMPORT(uart_begin)     void     dp_uart_begin(int port, uint32_t baud, int rx, int tx);
DP_IMPORT(uart_write)     void     dp_uart_write(int port, const uint8_t *p, size_t n);

// I2C master: returns Arduino endTransmission codes (0 ok, 2 NACK on address, 3 NACK on data, 4 other)
DP_IMPORT(i2c_master_begin) void   dp_i2c_master_begin(int port, int sda, int scl, uint32_t hz);
DP_IMPORT(i2c_xfer)       int      dp_i2c_xfer(int port, int addr, const uint8_t *w, size_t wn,
                                               uint8_t *r, size_t rn, int stop);
// SPI master: mode 0..3. spi_xfer is full duplex, blocks for the reply, returns 0 on success
DP_IMPORT(spi_begin)      void     dp_spi_begin(int port, int sck, int miso, int mosi, int cs, uint32_t hz, int mode);
DP_IMPORT(spi_xfer)       int      dp_spi_xfer(int port, const uint8_t *w, uint8_t *r, size_t n);
// fields (user-editable values, manifest order) and outputs (values shown on the part's picture)
DP_IMPORT(field_f64)      double   dp_field_f64(int idx);
DP_IMPORT(output_f64)     void     dp_output_f64(int idx, double v);

// I2C slave: the bench will call dp_i2c_slave_event() for each transaction aimed at addr
DP_IMPORT(i2c_slave_begin) void    dp_i2c_slave_begin(int port, int addr, int sda, int scl);
}
