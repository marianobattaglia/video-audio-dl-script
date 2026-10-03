# Spec Delta

## Purpose

Lets a user submit a supported media URL in a browser, choose a video or audio output, and receive the resulting file without installing downloader tools on their device.

## ADDED Requirements

### Requirement: Download media from a submitted URL
The system SHALL let the user submit an HTTP or HTTPS media URL and choose video (MP4) or audio (MP3). The service SHALL process the request using the project's established `yt-dlp` format and quality options, with required media tools available in the service environment.

#### Scenario: Submit a video download
- **WHEN** the user submits a supported public URL and selects video
- **THEN** the system processes the URL as an MP4 video download and makes the resulting file available to the browser

#### Scenario: Submit an audio download
- **WHEN** the user submits a supported public URL and selects audio
- **THEN** the system extracts an MP3 audio file using the configured best audio quality and makes it available to the browser

#### Scenario: Reject an invalid URL
- **WHEN** the submitted value is malformed, uses a scheme other than HTTP or HTTPS, or targets a loopback or private network address
- **THEN** the system rejects the request before starting a download and explains that a public HTTP or HTTPS URL is required

### Requirement: Report download progress and outcome
The system SHALL show that a download is in progress, communicate available progress updates, and present a clear success or failure outcome. A failed or unsupported download SHALL provide a user-readable explanation and SHALL NOT be presented as a successful download.

#### Scenario: Download completes
- **WHEN** media processing finishes successfully
- **THEN** the system offers the generated file to the browser with a suitable filename and media type

#### Scenario: Download fails
- **WHEN** the source is unsupported, unavailable, or processing fails
- **THEN** the system shows a failure message and allows the user to submit another URL

#### Scenario: Source requires local browser cookies
- **WHEN** a source requires authentication cookies from the user's local browser profile
- **THEN** the system reports that the source cannot be processed by the public-URL workflow and does not claim to use local browser cookies

### Requirement: Protect the download service and temporary files
The system SHALL only fetch public HTTP or HTTPS destinations, including after redirects. It SHALL enforce configured limits on concurrent downloads and maximum processing duration, isolate each download's temporary files, and remove temporary files after delivery, failure, or expiration.

#### Scenario: URL redirects to a private destination
- **WHEN** a submitted URL redirects to a loopback, private, or link-local address
- **THEN** the system blocks the request before fetching that destination

#### Scenario: Download exceeds configured limits
- **WHEN** a download cannot begin because the concurrency limit is reached or exceeds the configured processing duration
- **THEN** the system rejects or terminates that download with a clear status and releases its temporary resources

#### Scenario: Temporary output is no longer needed
- **WHEN** a file has been delivered, its download fails, or its retention period expires
- **THEN** the system deletes that download's temporary files
