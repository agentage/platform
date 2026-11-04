import {
  Card as DsCard,
  CardContent,
  CardHeader,
  CardTitle,
  type CardRootProps,
} from '@agentage/design-system/card';
import { type ReactNode } from 'react';

export interface CardProps extends Omit<CardRootProps, 'title' | 'children'> {
  title?: ReactNode;
  children?: ReactNode;
}

export const Card = ({ title, children, ...props }: CardProps) => (
  <DsCard {...props}>
    {title !== undefined && (
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
    )}
    <CardContent>{children}</CardContent>
  </DsCard>
);
