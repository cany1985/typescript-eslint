import type { TSESTree } from '@typescript-eslint/utils';

import { AST_NODE_TYPES } from '@typescript-eslint/utils';

import { createRule, isParenthesized } from '../util';

/**
 * Check whatever node can be considered as simple
 * @param node the node to be evaluated.
 */
function isSimpleType(node: TSESTree.Node): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.Identifier:
    case AST_NODE_TYPES.TSAnyKeyword:
    case AST_NODE_TYPES.TSBooleanKeyword:
    case AST_NODE_TYPES.TSNeverKeyword:
    case AST_NODE_TYPES.TSNumberKeyword:
    case AST_NODE_TYPES.TSBigIntKeyword:
    case AST_NODE_TYPES.TSObjectKeyword:
    case AST_NODE_TYPES.TSStringKeyword:
    case AST_NODE_TYPES.TSSymbolKeyword:
    case AST_NODE_TYPES.TSUnknownKeyword:
    case AST_NODE_TYPES.TSVoidKeyword:
    case AST_NODE_TYPES.TSNullKeyword:
    case AST_NODE_TYPES.TSArrayType:
    case AST_NODE_TYPES.TSUndefinedKeyword:
    case AST_NODE_TYPES.TSThisType:
    case AST_NODE_TYPES.TSQualifiedName:
      return true;
    case AST_NODE_TYPES.TSTypeReference:
      if (
        node.typeName.type === AST_NODE_TYPES.Identifier &&
        node.typeName.name === 'Array'
      ) {
        if (!node.typeArguments) {
          return true;
        }
        if (node.typeArguments.params.length === 1) {
          return isSimpleType(node.typeArguments.params[0]);
        }
      } else {
        if (node.typeArguments) {
          return false;
        }
        return isSimpleType(node.typeName);
      }
      return false;
    default:
      return false;
  }
}

/**
 * Check if node needs parentheses
 * @param node the node to be evaluated.
 */
function typeNeedsParentheses(node: TSESTree.Node): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.TSTypeReference:
      return typeNeedsParentheses(node.typeName);
    case AST_NODE_TYPES.TSUnionType:
    case AST_NODE_TYPES.TSFunctionType:
    case AST_NODE_TYPES.TSIntersectionType:
    case AST_NODE_TYPES.TSTypeOperator:
    case AST_NODE_TYPES.TSInferType:
    case AST_NODE_TYPES.TSConstructorType:
    case AST_NODE_TYPES.TSConditionalType:
      return true;
    case AST_NODE_TYPES.Identifier:
      return node.name === 'ReadonlyArray';
    default:
      return false;
  }
}

export type OptionString = 'array' | 'array-simple' | 'generic';
export type Options = [
  {
    default: OptionString;
    readonly?: OptionString;
  },
];
export type MessageIds =
  | 'errorStringArray'
  | 'errorStringArrayReadonly'
  | 'errorStringArraySimple'
  | 'errorStringArraySimpleReadonly'
  | 'errorStringGeneric'
  | 'errorStringGenericSimple';

export default createRule<Options, MessageIds>({
  name: 'array-type',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Require consistently using either `T[]` or `Array<T>` for arrays',
      recommended: 'stylistic',
    },
    fixable: 'code',
    messages: {
      errorStringArray:
        "Array type using '{{className}}<{{type}}>' is forbidden. Use '{{readonlyPrefix}}{{type}}[]' instead.",
      errorStringArrayReadonly:
        "Array type using '{{className}}<{{type}}>' is forbidden. Use '{{readonlyPrefix}}{{type}}' instead.",
      errorStringArraySimple:
        "Array type using '{{className}}<{{type}}>' is forbidden for simple types. Use '{{readonlyPrefix}}{{type}}[]' instead.",
      errorStringArraySimpleReadonly:
        "Array type using '{{className}}<{{type}}>' is forbidden for simple types. Use '{{readonlyPrefix}}{{type}}' instead.",
      errorStringGeneric:
        "Array type using '{{readonlyPrefix}}{{type}}[]' is forbidden. Use '{{className}}<{{type}}>' instead.",
      errorStringGenericSimple:
        "Array type using '{{readonlyPrefix}}{{type}}[]' is forbidden for non-simple types. Use '{{className}}<{{type}}>' instead.",
    },
    schema: [
      {
        type: 'object',
        $defs: {
          arrayOption: {
            type: 'string',
            enum: ['array', 'generic', 'array-simple'],
          },
        },
        additionalProperties: false,
        properties: {
          default: {
            $ref: '#/items/0/$defs/arrayOption',
            description: 'The array type expected for mutable cases.',
          },
          readonly: {
            $ref: '#/items/0/$defs/arrayOption',
            description:
              'The array type expected for readonly cases. If omitted, the value for `default` will be used.',
          },
        },
      },
    ],
  },
  defaultOptions: [
    {
      default: 'array',
    },
  ],
  create(context, [options]) {
    const defaultOption = options.default;
    const readonlyOption = options.readonly ?? defaultOption;

    /**
     * @param node the node to be evaluated.
     */
    function getMessageType(node: TSESTree.Node): string {
      if (isSimpleType(node)) {
        return context.sourceCode.getText(node);
      }
      return 'T';
    }

    return {
      TSArrayType(node): void {
        const isReadonly =
          node.parent.type === AST_NODE_TYPES.TSTypeOperator &&
          node.parent.operator === 'readonly';

        const currentOption = isReadonly ? readonlyOption : defaultOption;

        if (
          currentOption === 'array' ||
          (currentOption === 'array-simple' && isSimpleType(node.elementType))
        ) {
          return;
        }

        const messageId =
          currentOption === 'generic'
            ? 'errorStringGeneric'
            : 'errorStringGenericSimple';
        const errorNode = isReadonly ? node.parent : node;

        context.report({
          node: errorNode,
          messageId,
          data: {
            type: getMessageType(node.elementType),
            className: isReadonly ? 'ReadonlyArray' : 'Array',
            readonlyPrefix: isReadonly ? 'readonly ' : '',
          },
          fix(fixer) {
            const typeNode = node.elementType;
            const arrayType = isReadonly ? 'ReadonlyArray' : 'Array';

            return [
              fixer.replaceTextRange(
                [errorNode.range[0], typeNode.range[0]],
                `${arrayType}<`,
              ),
              fixer.replaceTextRange(
                [typeNode.range[1], errorNode.range[1]],
                '>',
              ),
            ];
          },
        });
      },

      TSTypeReference(node): void {
        if (
          node.typeName.type !== AST_NODE_TYPES.Identifier ||
          !(
            node.typeName.name === 'Array' ||
            node.typeName.name === 'ReadonlyArray' ||
            node.typeName.name === 'Readonly'
          ) ||
          (node.typeName.name === 'Readonly' &&
            node.typeArguments?.params[0].type !== AST_NODE_TYPES.TSArrayType)
        ) {
          return;
        }

        const isReadonlyWithGenericArrayType =
          node.typeName.name === 'Readonly' &&
          node.typeArguments?.params[0].type === AST_NODE_TYPES.TSArrayType;
        const isReadonlyArrayType =
          node.typeName.name === 'ReadonlyArray' ||
          isReadonlyWithGenericArrayType;

        const currentOption = isReadonlyArrayType
          ? readonlyOption
          : defaultOption;

        if (currentOption === 'generic') {
          return;
        }

        const readonlyPrefix = isReadonlyArrayType ? 'readonly ' : '';
        const typeParams = node.typeArguments?.params;
        const messageId =
          currentOption === 'array'
            ? isReadonlyWithGenericArrayType
              ? 'errorStringArrayReadonly'
              : 'errorStringArray'
            : isReadonlyArrayType && node.typeName.name !== 'ReadonlyArray'
              ? 'errorStringArraySimpleReadonly'
              : 'errorStringArraySimple';

        if (!typeParams || typeParams.length === 0) {
          // Create an 'any' array
          context.report({
            node,
            messageId,
            data: {
              type: 'any',
              className: isReadonlyArrayType ? 'ReadonlyArray' : 'Array',
              readonlyPrefix,
            },
            fix(fixer) {
              return fixer.replaceText(node, `${readonlyPrefix}any[]`);
            },
          });

          return;
        }

        if (
          typeParams.length !== 1 ||
          (currentOption === 'array-simple' && !isSimpleType(typeParams[0]))
        ) {
          return;
        }

        const type = typeParams[0];
        const typeParens = typeNeedsParentheses(type);
        const parentParens =
          readonlyPrefix &&
          node.parent.type === AST_NODE_TYPES.TSArrayType &&
          !isParenthesized(node.parent.elementType, context.sourceCode);

        const start = `${parentParens ? '(' : ''}${readonlyPrefix}${
          typeParens ? '(' : ''
        }`;
        const end = `${typeParens ? ')' : ''}${isReadonlyWithGenericArrayType ? '' : `[]`}${parentParens ? ')' : ''}`;
        context.report({
          node,
          messageId,
          data: {
            type: getMessageType(type),
            className: isReadonlyArrayType ? node.typeName.name : 'Array',
            readonlyPrefix,
          },
          fix(fixer) {
            return [
              fixer.replaceTextRange([node.range[0], type.range[0]], start),
              fixer.replaceTextRange([type.range[1], node.range[1]], end),
            ];
          },
        });
      },
    };
  },
});
