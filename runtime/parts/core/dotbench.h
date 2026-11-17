// dotbench extensions for sketches: read the part's editable fields, publish outputs.
// Indices come from the generated dotbench_fields.h (one enum entry per manifest field/output).
#pragma once
#include "Arduino.h"
double dotbenchField(int fieldIndex);            // current value of a number/integer/boolean/enum field
void dotbenchOutput(int outputIndex, double v);  // value shown on the part's picture / readable by tests
