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
    void getPhoto(photoId).then((photo) => {
      if (!photo || !active) return;
      url = URL.createObjectURL(photo);
      setLoaded({ id: photoId, url });
    }).catch(() => undefined);
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [getPhoto, nearViewport, photoId]);

  const url = nearViewport && loaded?.id === photoId ? loaded.url : undefined;
  return <div ref={frame} className={`local-photo-slot ${className}`} aria-hidden={alt === '' || undefined}>
    {url ? <img src={url} alt={alt}/> : fallback}
  </div>;
}
