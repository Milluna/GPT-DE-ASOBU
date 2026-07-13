# Low-stance taunt motion profile

`low-stance-taunts-v1` strengthens the two repeated taunt gestures without changing room, input, or network protocol behavior.

- `start-left` / `start-right` begin at frame zero in a low, wide shuttle-run endpoint pose. The outside leg plants, the inside leg tucks, the torso drops and leans, and the pose mirrors cleanly on every reversal.
- `racket-swing` begins at frame zero already crouched and coiled. The wind-up deepens during the first frames and immediately drives into the forward swing instead of pausing upright.
- The overlay is additive to `beautiful-3d-v3`, so the existing face, hair, cloth, racket, and character-specific animation remain active.
- Release metadata exposes `tauntMotionProfile=low-stance-taunts-v1` and capability flags for production verification.
