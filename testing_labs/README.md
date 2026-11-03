# FileFlow Testing Lab Suite

## 📋 What's Included

A comprehensive testing documentation suite with detailed test cases for validating FileFlow functionality.

### Documents Created

| Document | Tests | Pages | Size |
|----------|-------|-------|------|
| **Testing Index** | Overview | ~15 | 53KB |
| **Authentication & 2FA** | 30 cases | — | — |
| **File Management** | 27 cases | — | — |
| **Sharing & Collaboration** | 33 cases | — | — |
| **TOTAL** | **90 test cases** | — | — |

Page counts and sizes depend on the PDF export and are given once the PDFs are regenerated.

### Test Coverage

- ✅ **Authentication**: Login, 2FA setup, TOTP verification, recovery codes, session management
- ✅ **File Operations**: Upload, download, rename, move, copy, delete, trash, restore
- ✅ **Sharing**: Share links, password protection, expiration, public uploads
- ✅ **Collaboration**: Shared folders, member management, access control, permissions
- ✅ **Security**: Login lockout (IP, user+IP, account), 2FA step-up, link password throttling (429), download caps, path normalization, HTTPS/TLS, cookies, CSRF protection
- ✅ **Performance**: Large files, bulk operations, 500+ files, concurrent users

## 🚀 Quick Start

### For Testers
1. Open `01_authentication_2fa_testing_lab.pdf`
2. Follow each test case step-by-step
3. Record results in the Status column
4. Report any failures with test ID and reproduction steps

### For Automation
1. Use test IDs (1.1, 2.3, etc.) to create automated scripts
2. Map "Steps" to automation commands
3. Implement assertions from "Expected Results"
4. Group tests by feature for test suites

### For CI/CD Integration
1. Import test cases into test management tool
2. Link to version control commits
3. Track pass/fail rates per build
4. Generate test coverage reports

## 📊 Test Execution Timeline

**Recommended Execution**: 4 weeks

- **Week 1**: Functional Testing (Basic Features)
  - Authentication tests
  - File upload/download tests
  - Basic sharing tests
  - **Target**: 70% coverage

- **Week 2**: Advanced Testing (Edge Cases)
  - Large file handling
  - Bulk operations
  - Permission edge cases
  - **Target**: 90% coverage

- **Week 3**: Security & Performance
  - Security-focused tests
  - Rate limiting
  - Performance with 500+ files
  - **Target**: 95% coverage

- **Week 4**: Regression & Sign-Off
  - Retest failures
  - Verify fixes
  - Full regression pass
  - **Target**: 100% pass rate

## 📋 Test Summary by Feature

### Authentication & 2FA (30 tests)
- Login validation (valid, invalid, empty, injection)
- 2FA setup and recovery codes
- TOTP verification
- Recovery code authentication
- 2FA management (enable, disable, regenerate — password + code required)
- Session management and logout (cookies always cleared)
- Security (lockout per IP, per user+IP and per account; HTTPS, cookies)

### File Management (27 tests)
- Single & multiple file uploads
- Large file handling (100MB+)
- Drag & drop uploads
- Downloads (single, bulk, large)
- Resume interrupted downloads
- Rename (files, directories, special chars)
- Move and copy operations
- Delete and trash operations
- Bulk operations (100+ files)
- Public links following rename/move and removed on delete
- `..` paths rejected

### Sharing & Collaboration (33 tests)
- Basic share links
- Password-protected shares
- Expiring shares
- Share link revocation
- Shared folder creation
- Member management (add, remove, update permissions)
- Download-limited links (atomic cap, Range ignored)
- Links stop working when the creator loses access
- Upload requests for public submissions (own write access, password before files, no overwrite, `PUBLIC_UPLOAD_MAX_MB`)
- Access control & permissions
- Group-based access
- Activity logging
- Security (CSRF, token expiration, link password throttling)

## ✅ Completion Checklist

- [ ] All 90 test cases executed
- [ ] All failures documented with:
  - Test ID
  - Steps to reproduce
  - Actual vs expected results
  - Screenshots/logs
  - Browser/OS version
- [ ] Critical bugs fixed and retested
- [ ] High bugs reviewed (fix or document)
- [ ] Security tests 100% passing
- [ ] Performance baseline established
- [ ] Sign-off obtained from:
  - [ ] QA Lead
  - [ ] Development Lead
  - [ ] Product Owner
  - [ ] Release Manager

## 🔧 Using These Labs

### Finding a Test
1. Open the Index document (00_testing_index.pdf)
2. Use the Test ID mapping table
3. Go to the corresponding lab PDF
4. Search for the test ID (e.g., "1.1")

### Executing a Test
1. Read the "Objective" to understand what's being tested
2. Follow the "Steps" exactly as written
3. Compare actual results to "Expected Results"
4. Mark status in the results table
5. If failed, document in the bug report template

### Reporting Issues
Use the included bug report template:
```
Title: [Brief description]
Severity: [Critical/High/Medium/Low]
Test ID: [e.g., 2.1]
Steps to Reproduce: [Numbered steps]
Expected: [What should happen]
Actual: [What actually happened]
Screenshots: [Attach if helpful]
Environment: [Browser, OS, version]
```

## 📊 Test Results Tracking

Each lab includes a "Test Results Summary" table. At the end of testing:

- Count total tests
- Count passed tests
- Count failed tests
- Count blocked tests
- Calculate pass rate: `(Passed / Total) × 100%`
- Obtain tester sign-off

Example:
```
Total Tests: 23
Passed: 22 (95.7%)
Failed: 1 (4.3%)
Blocked: 0

Conclusion: Ready for Production with Known Issue
```

## 🔐 Security Test Highlights

Critical security tests included:
- SQL injection attempt (Test 1.5)
- Session timeout (Test 6.2)
- Rate limiting (Test 7.1) and lockout isolation (Tests 7.4, 7.5)
- 2FA step-up for disable/regenerate (Test 5.4)
- Logout without a valid session (Test 6.3)
- Download-limited links and Range (Sharing Tests 1.7, 1.8)
- Link password throttling (Sharing Test 6.4)
- Upload request password before files (Sharing Test 3.7)
- Dot-segment paths (File Management Test 7.1)
- HTTPS/TLS verification (Test 7.2)
- Cookie security (Test 7.3)
- CSRF protection (Test 6.3)
- Password exposure in logs (Test 6.2)
- Token expiration (Test 6.1)

## 📈 Performance Baselines

Use these tests to establish performance baselines:
- Single file upload time
- Large file (100MB+) upload time
- Bulk ZIP download time
- Directory listing with 500+ files
- Search performance with 1000+ files
- Permission evaluation time

## 🛠️ Extending These Labs

These labs can be extended with:
- API testing documentation
- Load testing scenarios
- Mobile testing procedures
- Accessibility (WCAG) testing
- Automated test scripts
- Performance benchmarks
- Security scanning procedures

## 📞 Support

For questions about testing:
1. Check the specific test lab PDF
2. Review the "Setup" section
3. Verify all prerequisites met
4. Check the troubleshooting appendix
5. Contact QA lead if still unclear

---

**Testing Labs Version**: 1.1  
**Created**: 2024-05-05  
**Updated**: 2026-10-27 (Driss OUAAZIZ)  
**Total Test Cases**: 90  
**Estimated Execution Time**: 30-40 hours  
**Target Completion**: 4 weeks

**Quick Links**:
- [Testing Index](00_testing_index.pdf) - Start here
- [Authentication Lab](01_authentication_2fa_testing_lab.pdf) - 30 tests
- [File Management Lab](02_file_management_testing_lab.pdf) - 27 tests
- [Sharing Lab](03_sharing_collaboration_testing_lab.pdf) - 33 tests

## Version History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2024-05-05 | 1.0 | Initial testing labs | Driss OUAAZIZ |
| 2026-10-27 | 1.1 | Labs updated for the October 2026 security fixes; 18 test cases added (90 in total) | Driss OUAAZIZ |
