# Tiny Stack VM — exact interpreter of make.fun's tiny stack ISA

[![tiny-stack-vm-01-run-20261122](https://make.fun/badge/tiny-stack-vm-01-run-20261122.svg)](https://make.fun/c/tiny-stack-vm-01-run-20261122)
[![rank](https://make.fun/badge/tiny-stack-vm-01-run-20261122/Samot72/tiny-stack-vm-01-run-20261122-entry/rank.svg)](https://make.fun/c/tiny-stack-vm-01-run-20261122)
[![reward](https://make.fun/badge/tiny-stack-vm-01-run-20261122/Samot72/tiny-stack-vm-01-run-20261122-entry/reward.svg)](https://make.fun/c/tiny-stack-vm-01-run-20261122)

`main.ts` runs every `/input/<id>/program.bin` on its `input.bin` and writes
`stdout.bin` + `exit.txt`. A faithful port of the kit's reference VM (`vm.mjs`, ISA.md v1):
exact 32-bit wrap, unsigned div/mod, the `INT_MIN / -1` edge cases, 5-bit shift counts,
`PUSH8` sign extension, all 10 traps with their own exit codes, and the step/output limits.

Practice set (official scorer): **1,000,000 / 1,000,000**, 40/40 answered. House baseline
plain-vm 1.0.0 scores 670,000 on the same set.
