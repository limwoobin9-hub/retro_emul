# Third-party software

- **EmulatorJS 4.2.3** (GBA and alternate DS cores), GPL-3.0: https://github.com/EmulatorJS/EmulatorJS/tree/v4.2.3
- **Pilas-melonDS**, MPL-2.0, pinned to `7adc554ce1dc5318fef3797e8f00a6e9286dac3b`: https://github.com/josepilas/pilas-melonds/tree/7adc554ce1dc5318fef3797e8f00a6e9286dac3b
- **melonDS**: https://github.com/melonDS-emu/melonDS
- **mGBA**: https://github.com/mgba-emu/mgba
- **DeSmuME**: https://github.com/TASEmulators/desmume
- **Azahar** (experimental threaded 3DS core), GPL-3.0: https://github.com/azahar-emu/azahar. Uses the EmulatorJS nightly distribution because the 4.2.3 frontend does not support Azahar.
- **fflate 0.8.2**, MIT: https://github.com/101arrowz/fflate. License included at `public/fflate-LICENSE.txt`.
- **Interface font**, a static subset derived from Noto Sans KR, SIL Open Font License 1.1. License included at `public/fonts/OFL.txt`. Original: https://github.com/google/fonts/tree/main/ofl/notosanskr

Emulation engines are downloaded on demand through same-origin Vercel rewrites. No ROMs, proprietary BIOS files, encryption keys, or firmware dumps are included.
