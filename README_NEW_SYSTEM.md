# New password-control system

Initial login password: `Alham@0038`
Initial admin master password: `SHAHNWAJ@88`

PDF passwords are number-based and admin-controlled. Initial pattern: PDF@001, PDF@002, ...
Excel passwords are number-based and admin-controlled. Initial pattern: EXCEL@001, EXCEL@002, ...

Admin is outside user login and can:
- change user login password
- change PDF #1..#100 passwords
- change Excel #1..#200 passwords
- use the admin master password to open any PDF/Excel

IMPORTANT: PDF access password here is a website-level password. If you upload a PDF that is itself encrypted with a PDF-reader password, the browser's own PDF viewer may ask for that second password. For the admin override to work cleanly, upload PDFs without built-in PDF encryption and let this website's password system protect them.


## Login
OTP/SMS verification is NOT used. User logs in directly with the user password.
