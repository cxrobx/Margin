import React from 'react';
import {
  BookOpen, Briefcase, Building2, Calendar, Camera, CheckSquare, Code, Code2,
  DollarSign, FileText, Film, Flame, Folder, Globe, GraduationCap, Hammer,
  Headphones, Heart, House, Inbox, Landmark, Leaf, Link2, Mail, Mic, Monitor,
  Music, Package, Palette, PenLine, PiggyBank, Pin, Rocket, Scale, Shield,
  ShoppingBag, Smartphone, Sparkles, Star, Target, Terminal, Trash2, Truck,
  User, Users, Zap
} from 'lucide-react';
import { ICON_HUES, isImageIcon } from '../shared/icons.mjs';

export const BUILTIN_ICONS = {
  folder: Folder, 'file-text': FileText, inbox: Inbox, pin: Pin,
  target: Target, briefcase: Briefcase, 'building-2': Building2, rocket: Rocket,
  music: Music, mic: Mic, headphones: Headphones, code: Code, 'code-2': Code2,
  terminal: Terminal, smartphone: Smartphone, monitor: Monitor, mail: Mail,
  'check-square': CheckSquare, calendar: Calendar, 'link-2': Link2,
  'dollar-sign': DollarSign, 'piggy-bank': PiggyBank, landmark: Landmark,
  house: House, hammer: Hammer, 'graduation-cap': GraduationCap,
  'book-open': BookOpen, 'pen-line': PenLine, camera: Camera, film: Film,
  palette: Palette, heart: Heart, users: Users, user: User, globe: Globe,
  'shopping-bag': ShoppingBag, package: Package, truck: Truck, zap: Zap,
  flame: Flame, leaf: Leaf, star: Star, scale: Scale, shield: Shield,
  sparkles: Sparkles, 'trash-2': Trash2
};

export const iconStyle = color => ICON_HUES.includes(color) ? { color: `var(--icon-${color})` } : undefined;
export const iconLabel = name => name.replace(/-2$/, '').replaceAll('-', ' ');

export default function NodeIcon({ icon, iconColor, fallback: Fallback = FileText, size = 14, className = '' }) {
  const Glyph = (icon?.startsWith('lucide:') && BUILTIN_ICONS[icon.slice(7)]) || Fallback;
  return <span className={`node-icon ${className}`} data-icon={icon || 'default'} style={isImageIcon(icon) ? undefined : iconStyle(iconColor)}>
    {isImageIcon(icon) ? <img src={icon} alt="" draggable={false} width={size + 2} height={size + 2} /> : <Glyph size={size} aria-hidden="true" />}
  </span>;
}
