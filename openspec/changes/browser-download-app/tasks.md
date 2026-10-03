# Tasks

## 1. Service foundation

- [x] 1.1 Add the web application and service entry points using a minimal stack suited to the repository, and verify that the service starts and serves its browser page.
- [x] 1.2 Define a deployment image or equivalent server runtime with pinned `yt-dlp` and `ffmpeg` versions, and verify the running service can locate both without requiring them on the user's device.
- [x] 1.3 Extract the launchers' format and extractor options into a non-interactive download path while keeping the existing Windows and macOS prompts and destinations intact; verify video still selects MP4 output and audio still selects best-quality MP3.

## 2. Download jobs and safety

- [x] 2.1 Add URL and output-kind validation for HTTP/HTTPS public destinations, and verify malformed, unsupported-scheme, loopback, private, and link-local URLs are rejected before processing.
- [x] 2.2 Implement bounded download jobs that invoke the downloader without a shell, capture progress and outcome, and enforce concurrency and duration limits; verify each state is available to the browser and limit failures release resources.
- [x] 2.3 Prevent redirects from reaching private or link-local destinations and verify redirect targets are revalidated before they are fetched.
- [x] 2.4 Store each job's output in an isolated temporary directory, serve only a sanitized filename and media type, and verify cleanup after success, failure, cancellation, and expiration.
- [x] 2.5 Map unsupported sources, tool failures, and sources requiring local browser cookies to bounded user-readable errors; verify responses do not expose server paths or raw process diagnostics.

## 3. Browser experience

- [x] 3.1 Add the URL field and MP4 video / MP3 audio choices, and verify the browser submits the selected values to the service.
- [x] 3.2 Show job progress, success, and failure states and allow another URL after an error; verify completed jobs offer the generated file with its suggested filename.

## 4. Deployment and integration

- [x] 4.1 Configure service resource and temporary-storage limits and verify expired or interrupted jobs are cleaned up after service restart.
- [x] 4.2 Document how to start and deploy the browser app with server-managed media tools, and verify a clean deployment needs only a browser on the user's device.
- [ ] 4.3 Verify the full browser flow for both output kinds in the deployed runtime and confirm the existing Windows and macOS launchers remain independently usable.
