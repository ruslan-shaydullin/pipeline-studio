import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Pipeline — рабочие процессы из ИИ-сессий',
  description:
    'Локальный прототип визуального редактора пайплайнов: проекты, промпты и отдельные сессии этапов.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
