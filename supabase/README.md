# The server moved to Inkwell

Since Nov 2026 the server half of Daybook and Inkwell (the Supabase database
migrations and every server function, including Scribe's and Acro HQ's) lives
in the inkwell repository, in `supabase/`:
https://github.com/laserbunny-coder/inkwell/tree/main/supabase

Make server changes there. Its `server.yml` workflow checks them on each pull
request and publishes them from main. This repository only publishes the
Daybook app now.
