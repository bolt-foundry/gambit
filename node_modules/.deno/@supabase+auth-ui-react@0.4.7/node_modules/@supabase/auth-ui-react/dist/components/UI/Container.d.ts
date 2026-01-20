import React from 'react';
import { Appearance } from '../../types';
export interface ContainerProps extends React.HtmlHTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    direction?: 'horizontal' | 'vertical';
    gap?: 'small' | 'medium' | 'large';
    appearance?: Appearance;
}
declare const Container: React.FC<ContainerProps>;
export { Container };
//# sourceMappingURL=Container.d.ts.map