import { useEffect, useRef, useState, type ReactNode } from 'react';
import { observeNearViewport } from '../viewport-observer';

interface Props {
  photoId: string;
  getPhoto: (id: string) => Promise<Blob | undefined>;
  className: string;
  alt: string;
  fallback?: ReactNode;
  eager?: boolean;
}

export function LocalPhoto({ photoId, getPhoto, className, alt, fallback, eager = false }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(eager);
  const [loaded, setLoaded] = useState<{ id: string; url: string }>();
  const [photoState, setPhotoState] = useState<{ id: string; state: 'loading'|'ready'|'error' }>();

  useEffect(() => {
    if (eager) {
      setNearViewport(true);
      return;
    }
    const element = frame.current;
    if (!element) {
      setNearViewport(true);
      return;
    }
    return observeNearViewport(element, (isNearViewport) => {
      setNearViewport(isNearViewport);
      if (!isNearViewport) setLoaded(undefined);
    });
  }, [eager, photoId]);

  useEffect(() => {
    if (!nearViewport) return;
    let active = true;
    let url = '';
    setPhotoState({ id: photoId, state: 'loading' });
    void getPhoto(photoId).then((photo) => {
      if (!photo) {
        if (active) setPhotoState({ id: photoId, state: 'error' });
        return;
      }
      if (!active) return;
      url = URL.createObjectURL(photo);
      setLoaded({ id: photoId, url });
      setPhotoState({ id: photoId, state: 'ready' });
    }).catch(() => { if (active) setPhotoState({ id: photoId, state: 'error' }); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [getPhoto, nearViewport, photoId]);

  const url = nearViewport && loaded?.id === photoId ? loaded.url : undefined;
  const state = !nearViewport ? 'deferred' : url ? 'ready' : photoState?.id === photoId && photoState.state === 'error' ? 'error' : 'loading';
  return <div ref={frame} className={`local-photo-slot ${className}`} data-photo-state={state} aria-hidden={alt === '' || undefined}>
    {url ? <img src={url} alt={alt}/> : fallback}
  </div>;
}
