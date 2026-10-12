import { useEffect, useState } from 'react';
import Aurora from './Aurora';

/** Latar Aurora pelan untuk halaman masuk. Berhenti bila pengguna memilih kurangi animasi. */
export default function LoginBackdrop() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] [mask-image:linear-gradient(to_bottom,#000_40%,transparent)]" aria-hidden="true">
      <Aurora
        colorStops={['#1B7A5C', '#7CC8A5', '#268E6B']}
        lightMode
        amplitude={0.9}
        speed={0.6}
        opacity={0.55}
        paused={reduced}
        dpr={Math.min(globalThis.devicePixelRatio || 1, 1.5)}
      />
    </div>
  );
}
