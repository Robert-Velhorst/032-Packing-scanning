# Optional iOS voice commands and spoken steps

The registered `PackingVoice` plugin connects the existing packing controls to
Apple Speech and AVFAudio. It is off by default. Only **Enable voice** requests
Speech Recognition and microphone permission; availability checks do not prompt,
open the microphone, or request a model download. Touch controls stay available.
The usage descriptions are included in the app's Info.plist.

Recognition requires an available `en-US` recognizer reporting
[`supportsOnDeviceRecognition`](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition).
Every audio request sets
[`requiresOnDeviceRecognition`](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition)
to true. Apple documents that both settings are necessary to prevent audio
being sent for network recognition. There is no fallback request, URL upload,
audio file, transcript history or analytics in this adapter. The OS remains a
dependency; actual offline/provider behavior needs device acceptance.

The native request accepts only final results. Transcripts are bounded to 256
UTF-16 units; missing, nonfinite or invalid confidence becomes zero. The minimum
confidence of every reported word segment is passed to the existing parser,
which requires a complete **Packing** command and at least 0.75 confidence.
The existing confirmation, original-workspace authority and idle-lock rules
still govern actions. Recognition confidence is not evidence of physical fit.

Each microphone session is limited to 20 seconds. A timeout closes it and lets
the foreground controller prepare another bounded request. An error requires
explicitly enabling voice again. Pending permission callbacks expire after two
minutes; stopping or changing steps invalidates their session ID before cleanup.
The bridge adapter also discards callbacks after a rejected start. Audio buffers
are synchronized with cancellation so no buffer is appended after `endAudio`.
Backgrounding, protected-data loss, audio interruption or media-service loss
stops input and reading without automatic resumption.

**Read this step aloud** uses an available standard-quality Apple English voice
from [`speechVoices()`](https://developer.apple.com/documentation/avfaudio/avspeechsynthesisvoice/speechvoices()).
Third-party identifiers, enhanced/premium downloads and unspecified default
voices are not selected. It requests no voice installation. Missing voices
leave the written step available. Reading cancels microphone capture, is bounded
to 2,000 UTF-16 units and three minutes, and stops when the shared UI requests
cancellation or the native lifecycle is interrupted. This is not background
audio. Available voice enumeration does not independently prove offline audio
or certify every OS/provider behavior; test with the network disabled.

## Verification and acceptance

Shared voice tests cover complete/uncertain commands, confirmations, workspace
authority, idle expiry, stale context, local-only browser support and reading.
The native adapter tests cover session filtering, missing confidence, cancellation
before listener setup and during native start, and rejected-start cleanup. They
use mocked bridge replies and do not run Apple Speech or AVFAudio.
The iOS build helper also compiles and executes 11 native Swift result-policy
cases, using the same function as the real bridge: partial results, per-word
minimum confidence, absent/invalid/nonfinite confidence, empty results and
UTF-16 size limits. These pure checks do not open an audio device.

The matching iOS CI run must compile both simulator Debug and unsigned device
Release before claiming native compilation. On supported iPhone/iPad hardware,
test a clean permission prompt, denial/revocation, unsupported/missing local
recognition, disabled-network operation, noisy/uncertain commands, no/low word
confidence, silence/timeouts, repeated commands, step changes and cancellation
during permission/start/results, incoming audio interruptions, background/lock,
reading cancellation, installed/missing voices and microphone/audio-session
release. Confirm no command changes a locked or different workspace. Physical
recognition accuracy, audio quality, offline/provider behavior and the broader
packing/scan acceptance remain unverified by compilation and mocked tests.
