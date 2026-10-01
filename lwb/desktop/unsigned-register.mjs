import { registerHooks } from 'node:module'
import { load } from './unsigned-loader.mjs'

if (process.env.LWB_DESKTOP_UNSIGNED === '1') registerHooks({ load })
