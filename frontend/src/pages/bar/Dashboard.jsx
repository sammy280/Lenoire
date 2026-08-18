import { Wine } from 'lucide-react';
import BarQueue from '../shared/BarQueue';

export default function BarDashboard() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Wine className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Bar Queue</h1>
      </div>
      <BarQueue />
    </div>
  );
}