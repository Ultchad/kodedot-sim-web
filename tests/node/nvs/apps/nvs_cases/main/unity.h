/* A minimal stand-in for ESP-IDF's Unity, just enough to compile the SDK's own test case files
 * (tests/host_nvs/cases/test_khal_nvs.c) UNMODIFIED into a dotbench app. Failures print and abort the case. */
#ifndef UNITY_SHIM_H
#define UNITY_SHIM_H
#include <setjmp.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef void (*unity_case_fn)(void);
void unity_register(const char *name, const char *tags, unity_case_fn fn);
void unity_fail(const char *file, int line, const char *msg);
extern jmp_buf unity_jmp;

#define UNITY_CAT2(a, b) a##b
#define UNITY_CAT(a, b) UNITY_CAT2(a, b)
#define TEST_CASE(name, tags) \
    static void UNITY_CAT(case_fn_, __LINE__)(void); \
    __attribute__((constructor)) static void UNITY_CAT(case_reg_, __LINE__)(void) { unity_register(name, tags, UNITY_CAT(case_fn_, __LINE__)); } \
    static void UNITY_CAT(case_fn_, __LINE__)(void)

#define TEST_FAIL_MESSAGE(m) unity_fail(__FILE__, __LINE__, (m))
#define TEST_ASSERT_TRUE(c) do { if (!(c)) unity_fail(__FILE__, __LINE__, "expected true: " #c); } while (0)
#define TEST_ASSERT_FALSE(c) do { if (c) unity_fail(__FILE__, __LINE__, "expected false: " #c); } while (0)
#define TEST_ASSERT_TRUE_MESSAGE(c, m) do { if (!(c)) unity_fail(__FILE__, __LINE__, (m)); } while (0)
#define TEST_ASSERT_FALSE_MESSAGE(c, m) do { if (c) unity_fail(__FILE__, __LINE__, (m)); } while (0)
#define TEST_ASSERT_EQUAL_INT(e, a) do { long long _e = (long long)(e), _a = (long long)(a); if (_e != _a) { char b[96]; snprintf(b, sizeof b, "expected %lld got %lld (" #a ")", _e, _a); unity_fail(__FILE__, __LINE__, b); } } while (0)
#define TEST_ASSERT_EQUAL_UINT(e, a) TEST_ASSERT_EQUAL_INT((unsigned long long)(e), (unsigned long long)(a))
#define TEST_ASSERT_EQUAL_UINT8(e, a) TEST_ASSERT_EQUAL_INT((uint8_t)(e), (uint8_t)(a))
#define TEST_ASSERT_EQUAL_STRING(e, a) do { const char *_e = (e), *_a = (a); if (strcmp(_e, _a)) { char b[160]; snprintf(b, sizeof b, "expected \"%s\" got \"%s\"", _e, _a); unity_fail(__FILE__, __LINE__, b); } } while (0)
#define TEST_ASSERT_EQUAL_MEMORY(e, a, n) do { if (memcmp((e), (a), (n))) unity_fail(__FILE__, __LINE__, "memory differs: " #a); } while (0)
#endif
