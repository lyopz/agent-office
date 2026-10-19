// Contract stub: a turntable 3D preview of one appearance. Replaced by the real three.js preview.
import type { Appearance } from '../model/types';

export interface AvatarPreview3DProps { appearance: Appearance; height?: number; autoRotate?: boolean; label?: string }

export function AvatarPreview3D({ appearance, height = 320, label }: AvatarPreview3DProps) {
  return <div className="avatar-preview-3d" style={{ height, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 8 }} aria-label={label ?? 'Avatar preview'}>{appearance.hairStyle}</div>;
}
