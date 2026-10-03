# Design

## Context

See proposal.md for the motivation and scope. The repository currently contains Windows and macOS terminal launchers. Both invoke `yt-dlp`, select MP4 or MP3 options, and write to the user's Desktop; neither is callable as a non-interactive web operation. There is no web application or server runtime in the repository yet.

## Goals / Non-Goals

**Goals:**
- Keep downloader and media-conversion requirements in the service environment so the user's device needs only a browser.
- Reuse the existing `yt-dlp` options and make one download's progress, output, and errors available to the browser.
- Bound service resource use and clean temporary output reliably.

**Non-Goals:**
- Read cookies or credentials from the user's browser profile, or download sources that require them.
- Provide accounts, a persistent media library, playlist or batch management, or format selection beyond MP4 video and MP3 audio.
- Change the behavior of the existing Windows and macOS launchers.

## Decisions

### Run downloads in a server-side worker

Provide a browser UI backed by a web service. The service environment supplies `yt-dlp` and `ffmpeg` (for example, as pinned components in the app's deployment image); they are not installed on the user's device. The worker invokes the tools as child processes with argument arrays and without a shell. It reuses the launchers' extractor setting, video selection and MP4 merge behavior, and best-quality MP3 extraction behavior.

The existing launchers cannot serve as the web worker because they prompt on a terminal, choose a fixed Desktop directory, and retry using browser-profile cookies. Extract the reusable download options into a non-interactive worker path while preserving the launchers' current user flow.

Alternative considered: package binaries separately for every user's operating system and run a local service. That would retain per-device installation, update, and platform setup concerns, so this change uses a server-managed runtime.

### Model each download as a bounded job

The API accepts a URL and output kind, returns a job identifier, and exposes status and progress until the job succeeds or fails. The browser polls the job status and requests the completed file. A job writes to its own temporary directory; only a sanitized filename and media type are returned. A small configured concurrency limit and processing timeout prevent a single service instance from accumulating unbounded work.

Alternative considered: keep one long-running HTTP request open until the media is ready. Job status makes progress, failure handling, and browser reconnects clearer, and allows the service to release resources on timeout.

### Validate destinations at fetch time

Accept only HTTP and HTTPS URLs. Validate the initial host and each redirect destination against loopback, private, and link-local address ranges, and prevent the downloader from following a redirect that bypasses this check. Pass the accepted URL as one process argument, never interpolate it into a shell command. Map process output and exit status to a bounded, user-readable message; do not return server paths or arbitrary diagnostic output.

The deployment container applies an egress firewall as the final destination check: it permits DNS only to Docker's embedded resolver and permits TCP web traffic only to public addresses on ports 80 and 443. This check applies to every connection made by the downloader, including connections after redirects or DNS changes.

### Keep output temporary

Store output in per-job temporary directories outside the static web root. Remove it after a completed response, on failure or cancellation, and through a retention cleanup for interrupted jobs. Do not persist job history or media beyond that temporary lifecycle.

### Treat browser cookies as unsupported

The server must not attempt to read the user's local browser profile. If a source needs those cookies, report that the URL is unsupported in this workflow. A future authenticated-source feature would need an explicit credential transfer design and is outside this change.

## Risks / Trade-offs

- [Supported sites can change their extraction behavior] → Keep `yt-dlp` versioned in the service deployment and report extraction failures clearly.
- [A public service can be abused to consume bandwidth or disk] → Restrict destinations, cap concurrency and processing time, keep temporary retention short, and configure deployment resource limits.
- [Large media can fill temporary storage or make browser downloads slow] → Enforce deployment storage limits, stream completed files to the client, and clean up on disconnect and expiration.
- [A service restart can interrupt active jobs] → Treat jobs as transient and let the browser submit the URL again after a server-side failure.
- [Some users expect the current cookie retry to work] → Explain that authenticated sources requiring local browser cookies are unsupported in the web workflow.

## Migration Plan

1. Add the web service and UI alongside the existing platform launchers; configure the service runtime with `yt-dlp` and `ffmpeg`.
2. Verify both output modes and temporary-file cleanup in the deployed environment before making the browser URL available.
3. If deployment must be rolled back, remove or disable the web service and retain the existing launchers, which remain independently usable with their current local prerequisites.
