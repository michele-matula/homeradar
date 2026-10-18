// Build per i test end-to-end: pause e attese del giro brevissime (WXT_SWEEP_FAST). Mai usarla per il pilota.
import { execSync } from 'node:child_process';

execSync('npx wxt build', { stdio: 'inherit', env: { ...process.env, WXT_SWEEP_FAST: '1' } });
