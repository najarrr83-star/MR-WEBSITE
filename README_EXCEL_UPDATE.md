# secure-pdf-website — Excel update

This is your original project with the Excel changes added.

### Excel behavior
- Existing PDF/login/permission/admin features are preserved.
- Any `.xlsx` / `.xls` in the project folder automatically appears.
- Search box filters Excel names.
- Clicking Open Excel asks for a password.
- Password is automatically the Excel filename WITHOUT `.xlsx` / `.xls`, case-insensitive.
  - `ABHISHEK YADAV.xlsx` -> `ABHISHEK YADAV`
  - `Akhilesh_Pandey.xlsx` -> `Akhilesh Pandey` (because the site display name converts `_`/`-` to spaces)
- The original Excel file is NOT sent as a download.
- After the password, the workbook is rendered as an online editable table.
- Cells can be selected/copied and edited in the browser.
- Multiple sheets appear as tabs.
- Browser edits are not saved back to the original Excel file.

### Deploy
Run `npm install` then `npm start`.

Important: the Excel file still has to exist on the server. On services with ephemeral storage, files added manually at runtime can disappear after a restart/redeploy; persistent storage or redeploying the file is needed for long-term storage.
