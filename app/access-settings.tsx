'use client';
import { useId, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { accessModes } from '@/lib/access.mjs';
import type { AccessMode } from '@/lib/pipeline';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export function AccessSelect({
  value = 'supervised',
  onChange,
  disabled = false,
}: {
  value?: AccessMode;
  onChange: (value: AccessMode) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const selected = accessModes.find((option) => option.value === value)!;
  return (
    <div className="access-field">
      <label htmlFor={id}>Доступ агента</label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as AccessMode)}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-describedby={id + '-hint'}>
          <SelectValue>{selected.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {accessModes.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        id={id + '-hint'}
        className={'field-hint' + (value === 'full' ? ' access-full-hint' : '')}
      >
        {selected.description}
      </p>
    </div>
  );
}

export function PipelineAccess({
  value,
  onChange,
  disabled,
}: {
  value?: AccessMode;
  onChange: (value: AccessMode) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = accessModes.find(
    (option) => option.value === (value ?? 'supervised'),
  )!;
  return (
    <>
      <button
        className="assistant-button access-button"
        onClick={() => setOpen(true)}
        aria-label={'Доступ пайплайна: ' + selected.label}
        title={'Доступ: ' + selected.label}
      >
        <ShieldCheck size={16} />
        <span>Доступ</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="pipeline-access-dialog">
          <DialogHeader>
            <DialogTitle>Доступ пайплайна</DialogTitle>
            <DialogDescription>
              Один режим для всех этапов, включая созданные агентом.
            </DialogDescription>
          </DialogHeader>
          <AccessSelect value={value} onChange={onChange} disabled={disabled} />
          <p className="field-hint">
            Сохраняется в джобе и используется для следующих запусков. Текущий
            запуск сохраняет свой режим; при добавлении новых этапов его можно
            выбрать в окне продолжения.
          </p>
          <p className="field-hint">
            Вопросы по требованиям агент задаёт в любом режиме. Доступ к
            инструментам не меняет поставленную задачу.
          </p>
          <button className="primary-button" onClick={() => setOpen(false)}>
            Готово
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
