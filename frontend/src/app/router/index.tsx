import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { HomePage } from '@/App';
import { NotFoundPage } from '@/components/feedback/NotFoundPage';
import { AppShell } from '@/components/layout/AppShell';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: '*',
        element: <NotFoundPage />,
      },
    ],
  },
];

export const appRouter = createBrowserRouter(routes);

