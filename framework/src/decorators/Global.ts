import { ComponentConstructor } from '../BaseComponent';
import { createComponentOptionDecorator } from '../metadata/ComponentOptionMetadata';
import { createHandlerOptionDecorator } from '../metadata/HandlerOptionMetadata';

export function Global(isGlobal = true) {
  return function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: ComponentConstructor | Record<string, any>,
    propertyKey?: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor?: TypedPropertyDescriptor<any>,
  ): void {
    // is a property-decorator
    if (typeof target === 'object' && propertyKey && descriptor) {
      createHandlerOptionDecorator({ global: isGlobal })(target, propertyKey, descriptor);
    }
    // class-decorator
    else if (typeof target === 'function') {
      createComponentOptionDecorator({ global: isGlobal })(target);
    }
  };
}