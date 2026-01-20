import React from 'react';
import { Appearance } from '../../types';
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    children?: React.ReactNode;
    type: 'text' | 'password' | 'email';
    appearance?: Appearance;
}
declare const Input: React.FC<InputProps>;
export { Input };
//# sourceMappingURL=Input.d.ts.map