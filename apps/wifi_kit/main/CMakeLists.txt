idf_component_register(
    SRCS "app_main.c" "wifi_ao.c" "glyphs.c" "kit.c" "kit_name.c" "kit_store.c"
    INCLUDE_DIRS "."
    REQUIRES kode
    PRIV_REQUIRES kscreen
)
