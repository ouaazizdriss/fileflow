# FileFlow Feature Testing Checklist

## Authentication & Security
- [ ] Login with username/password
- [ ] 2FA setup - generate QR code and verify TOTP code
- [ ] 2FA recovery codes - use one to bypass authenticator
- [ ] 2FA disable - requires password **and** a TOTP or recovery code; other sessions are logged out
- [ ] Recovery code regeneration - requires password **and** a TOTP or recovery code
- [ ] 2FA setup refused (400) while 2FA is already enabled
- [ ] Wrong password or code on disable/regenerate - generic error, HTTP 429 after 5 failures
- [ ] Session persistence - stay logged in after refresh
- [ ] Logout functionality - HTTP 200, `fileflow_token` and `fileflow_2fa_pending` cleared, also with an expired or revoked session
- [ ] Login lockout - 5 failures lock the IP and the (username, IP) pair for 15 min (HTTP 429)
- [ ] Login lockout - 5 failures from one IP do not lock the same account from another IP
- [ ] Login lockout - 50 failures on one account across all IPs lock it for 15 min; not reset by a successful login
- [ ] Deleted then recreated account - old session of the deleted account rejected

## File Management
- [ ] List files/folders in directory
- [ ] Create new folder
- [ ] Upload single file
- [ ] Upload multiple files
- [ ] Download single file
- [ ] Delete file (move to trash)
- [ ] Rename file
- [ ] Copy file/folder
- [ ] Cut and paste file/folder
- [ ] Move file/folder with dialog
- [ ] Paths containing `..` rejected (HTTP 400)

## Search & Filters
- [ ] Basic text search by filename
- [ ] Full-text search (search inside files)
- [ ] Toggle full-text on/off
- [ ] Filter by file type (all, documents, images, video, code, archive, audio)
- [ ] Sort results (relevance, name, modified, size)
- [ ] Clear filters button

## Tags & Collections
- [ ] Add tags to single file
- [ ] Remove tags from file
- [ ] Add tags to multiple files (bulk)
- [ ] Search by tag (using #tag syntax)
- [ ] Display tags in preview panel

## File Sharing
- [ ] Create share link with expiration
- [ ] Share link with password protection
- [ ] Copy share URL
- [ ] Delete share link
- [ ] View all shared links
- [ ] Public access to shared files (unauthenticated)
- [ ] Expired or unknown link - same HTTP 404 message
- [ ] Wrong link password 5 times - HTTP 429 for 15 min, even with the correct password
- [ ] Download-limited link (cap 1) - second download HTTP 404; parallel requests deliver the file once
- [ ] Download-limited link with `Range` header - whole file returned (200) and counted; uncapped link returns 206
- [ ] Rename/move shared file - link still works; delete it - link returns 404 and is removed
- [ ] Creator disabled or loses read access - link returns 404; works again once access is restored

## Collaboration
- [ ] Create shared folder
- [ ] Add members to shared folder
- [ ] Remove members from shared folder
- [ ] Access shared folder as different user
- [ ] Creating a shared folder requires the creator's own read access (not via a received share)
- [ ] Granting write to a member requires the creator's own write access
- [ ] Creator loses rights - members lose the same rights immediately
- [ ] Delete shared folder

## Upload Requests
- [ ] Create upload request link
- [ ] Set expiration on upload request
- [ ] Protect with password
- [ ] View all upload request links
- [ ] Public upload to request folder
- [ ] Creating an upload request requires own write access (read-only user / share recipient refused, 403)
- [ ] Existing file name - new upload saved as `name (1).ext`, never overwritten
- [ ] Files sent before the password field are refused; nothing written
- [ ] Wrong upload password 5 times - HTTP 429
- [ ] Upload above `PUBLIC_UPLOAD_MAX_MB` (default 100) refused, no leftover files
- [ ] Creator loses write access - link returns 404
- [ ] Rename/move target folder - request follows; delete folder - request removed
- [ ] Delete upload request link

## File Preview & Viewing
- [ ] View image files
- [ ] Preview PDF files
- [ ] Preview text files
- [ ] Preview markdown with rendering
- [ ] Preview CSV with table display
- [ ] Syntax highlight code files (JS, Python, etc.)
- [ ] View file info (size, modified date)

## Trash & Versions
- [ ] Move to trash
- [ ] List trash contents
- [ ] Restore from trash
- [ ] Empty trash
- [ ] View version history
- [ ] Restore old file version

## Storage Management
- [ ] View storage quota widget
- [ ] See used vs total space
- [ ] Color warning at 80% usage
- [ ] Color critical at 95% usage

## Admin Features
- [ ] Create new user
- [ ] Edit user (disable, quota, role)
- [ ] Delete user
- [ ] Last active admin cannot be demoted, disabled or deleted (HTTP 400); a disabled admin does not count
- [ ] Create group with permissions
- [ ] Edit group (paths, permissions)
- [ ] Delete group
- [ ] View audit logs
- [ ] Filter audit logs

## UI/UX
- [ ] Grid view for files
- [ ] List view for files
- [ ] Theme switching (dark, light, corporate, fileflow)
- [ ] Language switching (EN, FR)
- [ ] Responsive design
- [ ] Keyboard shortcuts (Ctrl+F for search, Esc to close)

## Downloads
- [ ] Download single file
- [ ] Bulk download multiple files as ZIP
- [ ] Preserve folder structure in ZIP

## Edge Cases
- [ ] Large file upload (>1GB)
- [ ] Many files in directory (100+)
- [ ] Concurrent uploads
- [ ] Recover from network error
- [ ] Path with special characters
- [ ] Empty folders
- [ ] Hidden files

---

**Last updated**: 2026-10-27 (Driss OUAAZIZ) - security fixes of the October 2026 audit (2FA step-up, logout, login lockout, last admin guard, public link throttling, download caps and Range, link lifecycle, upload request rules)
