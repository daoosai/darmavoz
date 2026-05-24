import React from 'react';
import { Tag } from 'lucide-react';

export default function PromosScreen() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center h-full min-h-[400px]">
      <div className="w-20 h-20 bg-slate-100 rounded-[28px] flex items-center justify-center mb-5 rotate-12 border border-slate-200">
        <Tag className="w-10 h-10 text-slate-300 transform -rotate-12" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 mb-1">Здесь будут ваши акции</h3>
      <p className="text-sm text-slate-500">Пока что тут пусто, но скоро появятся выгодные предложения со скидками.</p>
    </div>
  );
}
