# Test app for the apps area: an app that crashes two seconds after it starts. Built by `dotbench build`, which only reads
# project() and main/CMakeLists.txt.
cmake_minimum_required(VERSION 3.22)
set(PROJECT_VER "0.3.1")
project(crash_app)
idf_component_register(SRCS "crash_main.c" INCLUDE_DIRS ".")
