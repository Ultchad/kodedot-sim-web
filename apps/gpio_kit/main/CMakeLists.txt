idf_component_register(
    SRCS "app_main.c" "gpio_ao.c" "gpio_job.c" "glyphs.c" "kit.c" "kit_name.c" "kit_store.c"
    INCLUDE_DIRS "."
    REQUIRES kode
    PRIV_REQUIRES kscreen
)
