# Change Password Feature - Design Document

**Date:** 2026-02-08
**Status:** Approved

## Overview

A settings page accessible from the dashboard where users can change their password. The form requires the current password for verification and enforces a minimum 8-character length for the new password.

## Architecture

### New Files

- `app/settings/page.tsx` - Settings page with change password form
- `app/api/user/change-password/route.ts` - API endpoint to handle password change

### Modified Files

- `app/dashboard/page.tsx` - Add link to settings page in the header

### Flow

1. User clicks "Settings" link in dashboard header
2. Settings page displays with change password form
3. User enters current password, new password, and confirms new password
4. Frontend validates: all fields filled, new passwords match, min 8 chars
5. API verifies current password against database
6. API hashes new password with bcrypt and updates the `Investor` record
7. Success message shown, user stays logged in

## UI Design

### Settings Page (`/settings`)

- Header with "Settings" title and back link to dashboard
- Card component containing the change password form
- Form fields:
  - Current Password (password input, required)
  - New Password (password input, required, min 8 chars)
  - Confirm New Password (password input, required, must match)
- Submit button with loading state
- Error/success message display
- Uses existing shadcn/ui components (Card, Input, Label, Button)

### Dashboard Header

- Settings icon/link added next to the Logout button

## API Design

### Endpoint

`POST /api/user/change-password`

### Request Body

```json
{
  "currentPassword": "string",
  "newPassword": "string"
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Password changed successfully"
}
```

### Error Responses

| Status | Condition |
|--------|-----------|
| 401 | Not authenticated |
| 400 | Invalid current password |
| 400 | New password too short (min 8 chars) |
| 500 | Database error |

### Security Measures

- Requires authenticated session
- Verifies current password with `bcrypt.compare`
- Hashes new password with bcrypt (10 rounds, matching existing pattern)
- No password returned in response

## Implementation Tasks

1. Create API route `app/api/user/change-password/route.ts`
2. Create settings page `app/settings/page.tsx`
3. Add settings link to dashboard header
4. Test the complete flow
