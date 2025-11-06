require('dotenv').config();
/**
 * Supabase Configuration
 * Backend Supabase client setup for RPS MagicBlock Game
 */

const { createClient } = require('@supabase/supabase-js');

// Supabase configuration from environment variables
const supabaseUrl = process.env.SUPABASE_URL || 'your_supabase_project_url_here';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your_supabase_service_role_key_here';

if (!supabaseUrl || supabaseUrl === 'your_supabase_project_url_here') {
  console.warn('⚠️  SUPABASE_URL not configured. Please set environment variable.');
}

if (!supabaseServiceKey || supabaseServiceKey === 'your_supabase_service_role_key_here') {
  console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not configured. Please set environment variable.');
}

// Create Supabase client with service role key for backend operations
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = {
  supabase,
  supabaseUrl,
  isConfigured: supabaseUrl !== 'your_supabase_project_url_here' && supabaseServiceKey !== 'your_supabase_service_role_key_here'
}; 