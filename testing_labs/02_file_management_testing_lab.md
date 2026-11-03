# Testing Lab: File Management

## Overview
This testing lab covers core file management operations including upload, download, rename, move, delete, and restore from trash.

## Test Environment Setup

### Prerequisites
- FileFlow running on `http://localhost:3000`
- User logged in with write permissions
- Test files prepared:
  - Small text file (10KB)
  - Medium image (2MB)
  - Large video (100MB)
  - Directory structure for move/copy tests

### Test Files Location
- `/tmp/test_files/` (local test directory)
- `/files/test/` (FileFlow directory)

---

## Feature 1: File Upload

### Test 1.1: Single File Upload
**Objective**: Verify single file upload functionality  
**Steps**:
1. Navigate to file manager
2. Click "Upload" button or drag file to drop zone
3. Select `test_file.txt` (10KB)
4. Verify upload progress bar
5. Wait for upload to complete

**Expected Results**:
- ✓ Upload progress bar displayed
- ✓ File appears in directory after upload
- ✓ File size correct (10KB)
- ✓ File modification time correct
- ✓ Success notification shown
- ✓ File accessible for download immediately

---

### Test 1.2: Multiple File Upload
**Objective**: Verify uploading multiple files simultaneously  
**Steps**:
1. Click "Upload" button
2. Select 5 files at once
3. Watch upload progress
4. All files upload

**Expected Results**:
- ✓ All 5 files uploaded
- ✓ Progress shown for each file
- ✓ All files appear in directory
- ✓ Correct sizes for each file
- ✓ No file corruption
- ✓ Success message shows count: "5 files uploaded"

---

### Test 1.3: Large File Upload (100MB+)
**Objective**: Verify handling of large files  
**Steps**:
1. Prepare 150MB video file
2. Click "Upload"
3. Select large file
4. Monitor upload (may take 1-5 minutes)
5. Verify completion

**Expected Results**:
- ✓ Upload starts and shows progress
- ✓ Progress bar updates smoothly
- ✓ Upload completes successfully
- ✓ File size correct (150MB)
- ✓ File checksum verifiable
- ✓ Can download file without corruption

---

### Test 1.4: Drag and Drop Upload
**Objective**: Verify drag-and-drop upload works  
**Steps**:
1. Open file manager in one window
2. Open file explorer in another
3. Drag file from explorer to FileFlow
4. Drop on upload area

**Expected Results**:
- ✓ Drop zone highlights during drag
- ✓ File uploads when dropped
- ✓ Upload progress shown
- ✓ File appears in directory
- ✓ Same behavior as button upload

---

### Test 1.5: Upload to Nested Directory
**Objective**: Verify uploading to subdirectories  
**Steps**:
1. Navigate to `/files/test/subfolder1/`
2. Upload a file
3. Verify file appears in correct location

**Expected Results**:
- ✓ File uploads to correct directory
- ✓ Full path preserved
- ✓ File visible in subfolder
- ✓ Breadcrumb shows correct location

---

### Test 1.6: Duplicate Filename Upload
**Objective**: Verify handling of duplicate filenames  
**Steps**:
1. Upload `document.txt` (first time)
2. Upload `document.txt` again

**Expected Results**:
- ✓ First upload succeeds
- ✓ Second upload shows conflict dialog
- ✓ Options: "Replace" | "Keep Both" | "Cancel"
- ✓ If "Keep Both": file renamed to `document (1).txt`
- ✓ If "Replace": original overwritten
- ✓ Both options work correctly

---

### Test 1.7: Filename Sanitization
**Objective**: Verify dangerous characters removed from filenames  
**Steps**:
1. Create file named: `../../../etc/passwd`
2. Upload the file
3. Check resulting filename in FileFlow

**Expected Results**:
- ✓ Path traversal characters removed
- ✓ File uploaded safely
- ✓ Filename sanitized: `etc_passwd` (or similar)
- ✓ File stored in upload directory only
- ✓ No system files accessed or modified

---

## Feature 2: File Download

### Test 2.1: Single File Download
**Objective**: Verify downloading individual files  
**Steps**:
1. Navigate to file manager
2. Right-click on file
3. Select "Download"
4. File downloads to local machine

**Expected Results**:
- ✓ Download starts immediately
- ✓ File downloaded to Downloads folder
- ✓ Filename matches original
- ✓ File size correct
- ✓ File integrity maintained
- ✓ Can open and read file

---

### Test 2.2: Bulk Download as ZIP
**Objective**: Verify downloading multiple files as archive  
**Steps**:
1. Select 5 files
2. Right-click
3. Select "Download as ZIP"
4. ZIP downloads

**Expected Results**:
- ✓ ZIP file created
- ✓ Contains all 5 files
- ✓ Folder structure preserved
- ✓ ZIP size reasonable
- ✓ ZIP can be extracted
- ✓ All files intact after extraction

---

### Test 2.3: Download Large File
**Objective**: Verify downloading files >100MB  
**Steps**:
1. Download 150MB video file
2. Monitor download progress
3. Verify file integrity

**Expected Results**:
- ✓ Download starts
- ✓ Progress shown
- ✓ Download completes
- ✓ File size correct (150MB)
- ✓ MD5/SHA checksum matches
- ✓ File can be played/opened

---

### Test 2.4: Download Interrupted and Resumed
**Objective**: Verify resume capability if download interrupted  
**Steps**:
1. Start downloading large file
2. Pause download after 50% complete
3. Resume download
4. Verify completion

**Expected Results**:
- ✓ Resume feature available
- ✓ Continues from paused point
- ✓ No need to re-download from start
- ✓ Final file complete and valid

---

## Feature 3: File Rename

### Test 3.1: Rename File
**Objective**: Verify file rename functionality  
**Steps**:
1. Right-click on file: `old_name.txt`
2. Select "Rename"
3. Enter new name: `new_name.txt`
4. Press Enter or click "Save"

**Expected Results**:
- ✓ File renamed successfully
- ✓ New name appears in directory
- ✓ Old name no longer visible
- ✓ File size and content unchanged
- ✓ Modification timestamp updated
- ✓ File still accessible with new name

---

### Test 3.2: Rename with Special Characters
**Objective**: Verify handling of special characters  
**Steps**:
1. Rename file to: `document (2024-05-05) [draft].txt`
2. Verify rename succeeds

**Expected Results**:
- ✓ File renamed with allowed special chars
- ✓ Parentheses, brackets, hyphens preserved
- ✓ File accessible with new name
- ✓ Special characters don't cause issues

---

### Test 3.3: Rename to Existing Name
**Objective**: Verify handling duplicate names  
**Steps**:
1. Have files: `file1.txt` and `file2.txt`
2. Try to rename `file2.txt` to `file1.txt`

**Expected Results**:
- ✓ Rename prevented
- ✓ Error message: "File already exists"
- ✓ Original filename retained
- ✓ User can choose different name

---

### Test 3.4: Rename Directory
**Objective**: Verify renaming folders  
**Steps**:
1. Right-click on folder: `oldname/`
2. Select "Rename"
3. Enter new name: `newname`
4. Confirm

**Expected Results**:
- ✓ Folder renamed
- ✓ All contents preserved
- ✓ Paths updated correctly
- ✓ Files within still accessible
- ✓ Internal shares, shared folders, favorites, public share links and upload requests on the folder (or anything inside it) now point to the new path and keep working

---

## Feature 4: Move and Copy

### Test 4.1: Move File to Different Directory
**Objective**: Verify moving files between directories  
**Steps**:
1. Right-click on file in `/files/test/`
2. Select "Cut"
3. Navigate to `/files/archive/`
4. Right-click and select "Paste"

**Expected Results**:
- ✓ File moves to new location
- ✓ Original location shows file gone
- ✓ New location shows file
- ✓ File size unchanged
- ✓ File content intact
- ✓ Modification time updated
- ✓ An existing public share link to the file still downloads it from its new location

---

### Test 4.2: Copy File
**Objective**: Verify copying files  
**Steps**:
1. Right-click on file
2. Select "Copy"
3. Navigate to destination folder
4. Select "Paste"

**Expected Results**:
- ✓ File copied to new location
- ✓ Original file remains
- ✓ Copy has same name
- ✓ Copy has identical content
- ✓ Copy has new creation timestamp
- ✓ Both files independent

---

### Test 4.3: Move Multiple Files
**Objective**: Verify moving multiple files at once  
**Steps**:
1. Select 5 files
2. Right-click "Cut"
3. Navigate to destination
4. "Paste"

**Expected Results**:
- ✓ All 5 files move together
- ✓ No files left behind
- ✓ All appear in destination
- ✓ Batch operation succeeds

---

### Test 4.4: Move Directory with Contents
**Objective**: Verify moving folders with files  
**Steps**:
1. Have directory with 10+ files
2. Move entire directory to new location
3. Verify all contents moved

**Expected Results**:
- ✓ Entire directory structure preserved
- ✓ All nested files moved
- ✓ No files lost
- ✓ Directory accessible at new path
- ✓ Public links to files inside the directory and upload requests targeting it follow the move

---

## Feature 5: Delete and Trash

### Test 5.1: Delete File to Trash
**Objective**: Verify files go to trash, not permanent delete  
**Steps**:
1. Right-click on file
2. Select "Delete" or press Delete key
3. Confirm deletion
4. Check Trash folder

**Expected Results**:
- ✓ File no longer in original location
- ✓ File appears in Trash
- ✓ Trash shows deleted timestamp
- ✓ Can restore from Trash
- ✓ Original path remembered
- ✓ Public share links and upload requests on the file (or on anything inside a deleted folder) are removed: their URLs return 404, also after a restore

---

### Test 5.2: Permanent Delete from Trash
**Objective**: Verify files can be permanently deleted  
**Steps**:
1. Navigate to Trash
2. Select file
3. Click "Delete Permanently"
4. Confirm

**Expected Results**:
- ✓ File removed from Trash
- ✓ File no longer recoverable
- ✓ Storage space freed
- ✓ File disappears immediately

---

### Test 5.3: Restore from Trash
**Objective**: Verify files can be restored  
**Steps**:
1. Delete file to Trash
2. Navigate to Trash
3. Click "Restore" on file
4. Verify file back in original location

**Expected Results**:
- ✓ File restored to original directory
- ✓ File content unchanged
- ✓ File timestamps preserved
- ✓ File not in Trash anymore

---

### Test 5.4: Auto-Empty Trash After 30 Days
**Objective**: Verify auto-deletion of old trash items  
**Steps**:
1. Delete file to Trash
2. Set system clock forward 30 days
3. Check Trash

**Expected Results**:
- ✓ Files older than 30 days auto-deleted
- ✓ Newer files retained
- ✓ No manual cleanup needed
- ✓ Storage freed automatically

---

### Test 5.5: Links Do Not Attach to a Recreated File
**Objective**: Verify a public link cannot silently expose a new file created at the same path  
**Steps**:
1. Create a public share link for `/files/test/report.txt`
2. Delete `report.txt`
3. Upload a different file with the same name to `/files/test/`
4. Open the old share link

**Expected Results**:
- ✓ The old link returns 404 ("not found or expired")
- ✓ The new file is not exposed; a new link must be created for it

---

## Performance Tests

### Test 6.1: Upload 100 Small Files
**Objective**: Verify handling of many files  
**Steps**:
1. Create 100 text files (1KB each)
2. Upload all files
3. Verify all appear in directory
4. List directory

**Expected Results**:
- ✓ All 100 files upload
- ✓ Directory listing shows all files
- ✓ No performance degradation
- ✓ Can still navigate and search

---

### Test 6.2: Bulk Operation on 500+ Files
**Objective**: Verify bulk operations scale  
**Steps**:
1. Have directory with 500+ files
2. Select all files
3. Apply bulk tag or bulk move
4. Verify completion

**Expected Results**:
- ✓ Operation completes in <10 seconds
- ✓ All files affected correctly
- ✓ No timeouts
- ✓ UI remains responsive

---

## Security Tests

### Test 7.1: Dot-Segment Paths Rejected
**Objective**: Verify `..` segments cannot escape a group's allowed paths or a shared folder  
**Steps**:
1. Login as a user whose group is restricted to `/teamA`
2. Call `GET /api/files/download?path=/teamA/../teamB/secret.txt`
3. Call `GET /api/files?path=/teamA/./sub//` (listing with `.` and doubled slashes)

**Expected Results**:
- ✓ Step 2 rejected with HTTP 400 ("Invalid path"); no content from `/teamB` returned
- ✓ Step 3 treated as `/teamA/sub` (normalized), allowed as usual
- ✓ A direct request for `/teamB/secret.txt` returns 403

---

## Test Results Summary

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 1.1 | Single Upload | ☐ | |
| 1.2 | Multiple Upload | ☐ | |
| 1.3 | Large File Upload | ☐ | |
| 1.4 | Drag & Drop | ☐ | |
| 1.5 | Upload to Subfolder | ☐ | |
| 1.6 | Duplicate Filename | ☐ | |
| 1.7 | Filename Sanitization | ☐ | |
| 2.1 | Single Download | ☐ | |
| 2.2 | Bulk ZIP Download | ☐ | |
| 2.3 | Large Download | ☐ | |
| 2.4 | Download Resume | ☐ | |
| 3.1 | Rename File | ☐ | |
| 3.2 | Special Characters | ☐ | |
| 3.3 | Duplicate Name | ☐ | |
| 3.4 | Rename Directory | ☐ | |
| 4.1 | Move File | ☐ | |
| 4.2 | Copy File | ☐ | |
| 4.3 | Move Multiple | ☐ | |
| 4.4 | Move Directory | ☐ | |
| 5.1 | Delete to Trash | ☐ | |
| 5.2 | Permanent Delete | ☐ | |
| 5.3 | Restore from Trash | ☐ | |
| 5.4 | Auto-Empty Trash | ☐ | |
| 5.5 | Links vs Recreated File | ☐ | |
| 6.1 | 100 File Upload | ☐ | |
| 6.2 | 500+ Files Bulk Op | ☐ | |
| 7.1 | Dot-Segment Paths | ☐ | |

---

## Sign-Off

- **Tester Name**: ____________________
- **Test Date**: ____________________
- **Total Tests**: 27
- **Passed**: ____
- **Failed**: ____
- **Blocked**: ____

**Conclusion**: ☐ Ready for Production | ☐ Needs Fixes | ☐ Blocked

---

## Version History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2024-05-05 | 1.0 | Initial lab | Driss OUAAZIZ |
| 2026-10-27 | 1.1 | Public links and upload requests follow rename/move and are removed on delete; tests 5.5 and 7.1 (dot-segment paths) added | Driss OUAAZIZ |
