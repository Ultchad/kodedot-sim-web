/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef DOTBENCH_ESP_IDF_VERSION_H
#define DOTBENCH_ESP_IDF_VERSION_H
#define ESP_IDF_VERSION_MAJOR 6
#define ESP_IDF_VERSION_MINOR 1
#define ESP_IDF_VERSION_PATCH 0
#define ESP_IDF_VERSION_VAL(major, minor, patch) (((major) << 16) | ((minor) << 8) | (patch))
#define ESP_IDF_VERSION ESP_IDF_VERSION_VAL(ESP_IDF_VERSION_MAJOR, ESP_IDF_VERSION_MINOR, ESP_IDF_VERSION_PATCH)
#endif
