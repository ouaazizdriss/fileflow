# FileFlow Testing Lab Index

## Overview

This comprehensive testing documentation provides detailed test cases and procedures for validating all major features of FileFlow, a self-hosted file management system. Each testing lab contains:

- **Setup Instructions**: Environment preparation and prerequisites
- **Detailed Test Cases**: Step-by-step procedures with expected results
- **Test Coverage**: Functional, security, and performance tests
- **Results Tracking**: Standardized test result documentation
- **Sign-Off**: Formal test completion sign-off

## Document Structure

### Testing Labs Included

1. **Authentication & Two-Factor Authentication (2FA)**
   - File: `01_authentication_2fa_testing_lab.md`
   - Tests: 30 test cases
   - Coverage:
     - Basic login/logout (logout always clears cookies)
     - 2FA setup and verification
     - Recovery codes
     - 2FA changes with step-up (password + code) and session rotation
     - Session management (including tokens of deleted accounts)
     - Security (login lockout per IP, per user+IP and per account, HTTPS/TLS, cookie security)

2. **File Management**
   - File: `02_file_management_testing_lab.md`
   - Tests: 27 test cases
   - Coverage:
     - File upload (single, multiple, large, drag-and-drop)
     - File download (single, bulk, large files, resume)
     - File rename, move, copy (links follow the resource)
     - Delete and trash operations (links removed with the resource)
     - Path normalization (`..` rejected)
     - Performance with many files

3. **File Sharing & Collaboration**
   - File: `03_sharing_collaboration_testing_lab.md`
   - Tests: 33 test cases
   - Coverage:
     - Share links (basic, password-protected, expiring, download-limited, Range requests)
     - Link lifecycle (rename, move, delete) and creator access checks
     - Shared folders with member management (bounded by the creator's own rights)
     - Upload requests for anonymous uploads (own write access, password before files, no overwrite, size cap)
     - Access control and permissions
     - Collaboration features
     - Security (CSRF, token expiration, link password throttling)

## Testing Methodology

### Test Case Format

Each test follows a standardized format:

```
Test ID: [X.Y] (Feature.TestNumber)
Objective: [What is being tested]
Steps: [Step-by-step procedure]
Expected Results: [What should happen]
Test Data: [Specific values to use]
Verification: [How to confirm success]
```

### Test Status Indicators

- ☐ Not Started
- ☐ In Progress
- ☐ Passed
- ☐ Failed
- ☐ Blocked
- ☐ Deferred

### Severity Levels for Bugs

- **Critical**: Feature completely broken, data loss risk, security vulnerability
- **High**: Feature partially broken, significant user impact
- **Medium**: Feature works with workaround, minor user impact
- **Low**: Cosmetic issues, nice-to-have improvements

## Test Execution Plan

### Phase 1: Functional Testing (Week 1)
- Execute all basic functionality tests
- Verify features work as documented
- Test user workflows
- Target: 70% test coverage

### Phase 2: Advanced Testing (Week 2)
- Test edge cases and error conditions
- Test bulk operations and performance
- Test with various data types and sizes
- Target: 95% test coverage

### Phase 3: Security Testing (Week 3)
- Execute security-focused tests
- Verify access controls
- Test authentication mechanisms
- Verify data protection
- Target: 100% security test coverage

### Phase 4: Regression & Sign-Off (Week 4)
- Retest all failed items
- Verify fixes don't break other features
- Final sign-off from stakeholders
- Target: 100% test pass rate

## Prerequisites

### Software Requirements
- FileFlow application (latest version)
- Web browser (Chrome, Firefox, Safari, Edge)
- FTP/SFTP client (for backend verification)
- Authenticator app (Google Authenticator, Authy, etc.)
- Pandoc (for viewing PDF versions)

### User Accounts Required
| Username | Role | Purpose |
|----------|------|---------|
| admin | Administrator | System admin testing |
| user1 | Regular User | Primary test user |
| user2 | Regular User | Sharing/collaboration tests |
| user3 | Regular User | Permission testing |
| test.bot | Bot/Service Account | Automation tests (optional) |

### Test Data
- Small files (1KB, 10KB, 100KB)
- Medium files (1MB, 10MB)
- Large files (50MB, 100MB+)
- Various file types (txt, pdf, doc, jpg, mp4, zip)
- Directory structures (nested folders, 100+ files)

### Environment Setup Checklist

- [ ] FileFlow deployed and running
- [ ] All user accounts created
- [ ] Database/storage accessible
- [ ] Test files prepared and organized
- [ ] Authenticator app installed on test device
- [ ] Backup of production database taken
- [ ] Performance baseline established
- [ ] Test reporting tool configured

## Test Result Documentation

### Test Report Template

```
Test Lab: [Lab Name]
Tester: [Name]
Test Date: [Date]
Environment: [OS, Browser, Version]

Summary:
- Total Tests: XX
- Passed: XX (XX%)
- Failed: XX (XX%)
- Blocked: XX (XX%)

Issues Found:
1. [Critical Bug] Description
2. [High Bug] Description

Sign-Off:
- [ ] Recommended for Production
- [ ] Recommended with Known Issues
- [ ] Requires Rework
```

## Known Limitations & Caveats

1. **Browser Compatibility**: Tests assume modern browsers (Chrome 90+, Firefox 88+)
2. **Network Conditions**: Tests assume stable internet; network latency not tested
3. **Load Testing**: Performance tests are baseline only, not full load testing
4. **Mobile Testing**: Tests are desktop-focused; mobile responsiveness not included
5. **Accessibility**: WCAG compliance testing not included in this lab

## Extensions & Future Testing

These labs can be extended to include:

1. **API Testing**: Direct HTTP API endpoint testing
2. **Load Testing**: Performance under concurrent users
3. **Security Scanning**: OWASP Top 10 vulnerability scanning
4. **Mobile Testing**: iOS and Android client testing
5. **Automation**: Selenium/Cypress automated test suites
6. **Accessibility**: WCAG 2.1 AA compliance verification
7. **Internationalization**: Multi-language testing

## Using These Documents

### For Manual Testing
1. Open the relevant PDF
2. Follow test steps exactly
3. Document actual results
4. Note any deviations
5. Report bugs with clear reproduction steps

### For Test Automation
1. Use test IDs (1.1, 2.3, etc.) as test identifiers
2. Map test steps to automation commands
3. Implement assertions for expected results
4. Create test suites by feature area
5. Track automation progress separately

### For Continuous Integration
1. Export test results to CI/CD dashboard
2. Flag blocking issues automatically
3. Generate test coverage reports
4. Notify team of failed tests
5. Archive results by build/version

## Test Metrics & KPIs

### Tracking Metrics
- **Test Coverage**: Percentage of features/code tested
- **Pass Rate**: Percentage of tests that pass
- **Bug Density**: Number of bugs per 1000 lines of code
- **Test Execution Time**: Hours/days to complete testing
- **Defect Escape Rate**: Bugs found after release

### Success Criteria
- ✓ 100% of critical tests pass
- ✓ 95%+ of all tests pass
- ✓ All critical bugs fixed before release
- ✓ Security tests 100% pass rate
- ✓ No high-severity bugs remain

## Support & Questions

For questions about specific tests:
1. Consult the test case details in the relevant lab
2. Check the "Verification" section
3. Review expected results
4. Check troubleshooting sections

For test environment issues:
1. Review Prerequisites section
2. Verify all accounts and data prepared
3. Check FileFlow logs for errors
4. Restart services if needed
5. Reset test data if corrupted

## Version History

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2024-05-05 | 1.0 | Initial testing labs created | Driss OUAAZIZ |
| | | - Authentication & 2FA lab | |
| | | - File Management lab | |
| | | - Sharing & Collaboration lab | |
| 2026-10-27 | 1.1 | Labs updated for the October 2026 security fixes (2FA step-up, logout, login lockout model, last admin guard, link throttling, download caps and Range, link lifecycle, upload request rules); 18 test cases added (90 in total) | Driss OUAAZIZ |

## Appendices

### A. Common Test Scenarios

#### Scenario: New User Onboarding
1. Create account
2. First login
3. Upload first file
4. Share with colleague
5. Verify access

#### Scenario: Administrator Setup
1. Login as admin
2. Create users
3. Create groups
4. Set quotas
5. Verify permissions

#### Scenario: Secure File Sharing
1. Enable 2FA
2. Create password-protected share
3. Set expiration time
4. Share with external party
5. Revoke after use

### B. Troubleshooting Guide

**Q: Tests fail with "Connection refused"**
- A: Verify FileFlow is running, check port 8080

**Q: Share links not generating**
- A: Check backend logs, verify file exists, restart API

**Q: 2FA codes not working**
- A: Verify time sync on authenticator device, check timezone

**Q: Large files fail to upload**
- A: Check disk space, verify file size limit, check network

### C. Tool Setup Instructions

1. **Installing Authenticator App**
   - Download: Google Authenticator, Authy, or Microsoft Authenticator
   - Scan QR codes during 2FA setup
   - Save recovery codes securely

2. **Setting System Time for Testing**
   - Windows: Settings > Time & Language > Date & Time
   - macOS: System Preferences > Date & Time
   - Linux: `sudo timedatectl set-time "YYYY-MM-DD HH:MM:SS"`

3. **Clearing Browser Data**
   - Chrome/Firefox: Ctrl+Shift+Delete
   - Safari: Develop > Empty Caches
   - Clear cookies, localStorage, sessionStorage

---

## Sign-Off for Testing Completion

When all tests are completed, have the following personnel sign off:

**QA Lead**: _________________________ Date: _________

**Developers**: _________________________ Date: _________

**Product Owner**: _________________________ Date: _________

**Release Manager**: _________________________ Date: _________

---

*Last Updated: 2026-10-27*
*FileFlow Version: 1.0*
*Testing Labs Version: 1.1*
