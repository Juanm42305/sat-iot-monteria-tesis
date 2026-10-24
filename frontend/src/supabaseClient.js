import { createClient } from '@supabase/supabase-js'
import React, { useState, useEffect } from 'react';
import supabase from './supabaseClient';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)