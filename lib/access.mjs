/** @typedef {'supervised' | 'network' | 'full'} AccessMode */

export const accessModes = [
  {
    value: 'supervised',
    label: 'С подтверждениями',
    description:
      'Запись в рабочую папку. Сеть и действия за её пределами — по запросу.',
  },
  {
    value: 'network',
    label: 'Рабочая папка + сеть',
    description:
      'Сеть разрешена. Запись за пределами рабочей папки требует подтверждения.',
  },
  {
    value: 'full',
    label: 'Полный доступ',
    description:
      'Без песочницы и запросов технических разрешений. Агент может читать и менять файлы на компьютере и обращаться к сети.',
  },
];

/** @returns {AccessMode} */
export function normalizeAccessMode(mode) {
  if (mode === undefined) return 'supervised';
  if (!accessModes.some((option) => option.value === mode))
    throw new Error('Неизвестный режим доступа');
  return mode;
}

/** Translate one saved profile for every new or resumed Codex session. */
export function codexAccess(mode, cwd) {
  const access = normalizeAccessMode(mode);
  const approvalPolicy = access === 'full' ? 'never' : 'on-request';
  return {
    thread: {
      sandbox: access === 'full' ? 'danger-full-access' : 'workspace-write',
      approvalPolicy,
      approvalsReviewer: 'user',
      config: {
        'sandbox_workspace_write.network_access': access === 'network',
      },
    },
    turn: {
      approvalPolicy,
      approvalsReviewer: 'user',
      sandboxPolicy:
        access === 'full'
          ? { type: 'dangerFullAccess' }
          : {
              type: 'workspaceWrite',
              writableRoots: [cwd],
              networkAccess: access === 'network',
            },
    },
  };
}
