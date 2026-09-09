# Security reporting

Do not post credentials, authentication files, complete transcripts, or real prompts in public issues. Prefer GitHub private vulnerability reporting when the repository enables it. If that channel is unavailable, open a content-free issue asking for a private reporting channel before sending details.

Include a minimal synthetic reproduction, affected version, and which trust boundary is crossed. Local CLI execution runs with the user's account and selected CLI permissions. The extension does not isolate tasks from arbitrary software already running as the same user.

The transcript reader rejects symlinks at checked path segments and uses `O_NOFOLLOW` at the final open. This reduces accidental disclosure; it is not a hardened defense against a malicious same-user process racing ancestor-directory replacement or creating hard links. The extension neither reads authentication files intentionally nor accepts arbitrary file-read paths over IPC.
