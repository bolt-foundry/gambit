import React from 'react';
import { Appearance } from '../../types';
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children: React.ReactNode;
    icon?: React.ReactNode;
    color?: 'default' | 'primary';
    loading?: boolean;
    appearance?: Appearance;
}
declare const Button: React.FC<ButtonProps>;
export { Button };
//# sourceMappingURL=Button.d.ts.map