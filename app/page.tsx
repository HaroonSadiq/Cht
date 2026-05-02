// Landing page — Server Component.
//
// Phase 1 of the Next.js migration: this Server Component reads the
// legacy `index.html` ONCE at module load (build time), splits out
// the <style> and <body> blocks, and renders them into the React
// tree. The inline <script> from the legacy file is replayed via the
// LandingEffects Client Component below.
//
// Doing the read at module load means Next.js bundles the content
// into the build output — no file-system access at request time.
//
// In a follow-up commit this will be replaced with hand-written JSX,
// at which point the file read goes away.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import LandingEffects from './landing-effects';

const file = readFileSync(path.join(process.cwd(), 'index.html'), 'utf-8');
const styleMatch = file.match(/<style[^>]*>([\s\S]*?)<\/style>/);
const bodyMatch  = file.match(/<body[^>]*>([\s\S]*)<\/body>/);

const STYLE = styleMatch?.[1] ?? '';
// Strip <script> tags — React's dangerouslySetInnerHTML wouldn't run
// them anyway. Their behavior lives in LandingEffects instead.
const BODY = (bodyMatch?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/gi, '');

export default function HomePage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div dangerouslySetInnerHTML={{ __html: BODY }} />
      <LandingEffects />
    </>
  );
}
