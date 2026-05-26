import { createClient } from 'https://esm.sh/@supabase/supabase-js'

export const supabase = createClient(
  'https://aljrqilzioroblnmxorp.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFsanJxaWx6aW9yb2Jsbm14b3JwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDQwODgsImV4cCI6MjA5NTMyMDA4OH0.I2qLPRmJdkyEKRMcQpv_zyHtuSZRXphWGyand5hESQ4'
)