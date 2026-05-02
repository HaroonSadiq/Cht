// /signup — Server Component (phase 2 of Next.js migration).
//
// Reads the legacy signup.html at module load, splits out <style>
// and <body>, renders into the React tree. The original inline
// script (4-step onboarding flow, signup POST, prefs persistence)
// is replayed in SignupEffects.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import SignupEffects from './signup-effects';

const file = readFileSync(path.join(process.cwd(), 'signup.html'), 'utf-8');
const styleMatch = file.match(/<style[^>]*>([\s\S]*?)<\/style>/);
const bodyMatch  = file.match(/<body[^>]*>([\s\S]*)<\/body>/);

const STYLE = styleMatch?.[1] ?? '';
const BODY = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');

export const metadata = {
  title: 'Sign up · FlowBot',
  description: 'Create your FlowBot account and configure your private-beta environment.',
};

export default function SignupPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: BODY }} />
      <SignupEffects />
    </>
  );
}
