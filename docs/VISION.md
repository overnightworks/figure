# figure vision

## Why it exists

figure draws and drives a VRM figure: the animated 3D head and shoulders of an
AI agent, drawn by each person's own browser. No video is sent and no server
handles any media. One package does this for every app, so a figure looks and
behaves the same wherever an agent appears, and no app builds its own.

A figure lives. It breathes, blinks and glances around when idle, turns toward
whoever is speaking when it listens, shows that it works when it thinks, and
speaks with a real mouth shape per sound and a mood the agent chooses. figure
also owns the fleet's profile for a figure file, and a check that tells whether
a file meets it.

## For whom today

- The apps that show an agent: hopin's agent tile and presentator's
  co-presenter. They take figure, hand it a file and an audio source, and show
  their own symbol whenever figure says it cannot draw.
- personas, whose release check runs the profile check on each agent's figure
  file before the agent ships.
- Through them, the person in a call who sees the agent as a living figure
  instead of a symbol.

## What it is not

- Not a maker of figures: it generates none, and a figure file arrives ready.
- Not a voice: it speaks nothing and owns no voices. It only reads the audio it
  is handed.
- Not video: photoreal faces generated from a photo are not chosen. They need
  the GPU, add delay and send video through a server.
- Not a server: it fetches, stores and serves no file, and talks to no network.
- Not an app: it draws no fallback and no tile. Its app owns those.
- Not trusting: a figure file is untrusted input, and no code from it runs.

How it is built is in [ARCHITECTURE.md](ARCHITECTURE.md).
