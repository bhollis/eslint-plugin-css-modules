/* @flow */
import path from 'path';

import {
  getStyleImportNodeData,
  getStyleClasses,
  getPropertyName,
  getClassesMap,
  getFilePath,
  getAST,
  fileExists,
} from '../core';

import type { JsNode } from '../types';

export default {
  meta: {
    docs: {
      description: 'Checks that you are using all css/scss/less classes',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          camelCase: { enum: [true, 'dashes', 'only', 'dashes-only'] },
          markAsUsed: { type: 'array' },
        },
      }
    ],
  },
  create (context: Object) {
    const markAsUsed = context?.options?.[0]?.markAsUsed;
    const camelCase = context?.options?.[0]?.camelCase;

    /*
       maps variable name to property Object
       map = {
         [variableName]: {
           classes: { foo: false, 'foo-bar': false },
           classesMap: { foo: 'foo', fooBar: 'foo-bar', 'foo-bar': 'foo-bar' },
           node: {...}
         }
       }

       example:
       import s from './foo.scss';
       s is variable name

       property Object has two keys
       1. classes: an object with className as key and a boolean as value. The boolean is marked if it is used in file
       2. classesMap: an object with propertyName as key and its className as value
       3. node: node that correspond to s (see example above)
     */
    const map = {};

    return {
      ImportDeclaration (node: JsNode) {
        const styleImportNodeData = getStyleImportNodeData(node);

        if (!styleImportNodeData) {
          return;
        }

        const {
          importName,
          styleFilePath,
          importNode,
        } = styleImportNodeData;

        const styleFileAbsolutePath = getFilePath(context, styleFilePath);

        let classes = {};
        let classesMap = {};

        if (fileExists(styleFileAbsolutePath)) {
          // this will be used to mark s.foo as used in MemberExpression
          const ast = getAST(styleFileAbsolutePath);
          classes = ast && getStyleClasses(ast);
          classesMap = classes && getClassesMap(classes, camelCase);
        }

        map[importName] ??= {};

        map[importName].classes = classes;
        map[importName].classesMap = classesMap;

        // save node for reporting unused styles
        map[importName].node = importNode;

        // save file path for reporting unused styles
        map[importName].filePath = styleFilePath;
      },
      MemberExpression: (node: JsNode) => {
        /*
           Check if property exists in css/scss file as class
         */

        const objectName = node.object.name;
        const propertyName = getPropertyName(node, camelCase);

        if (!propertyName) {
          return;
        }

        const className = map[objectName]?.classesMap[propertyName];

        if (className == null) {
          return;
        }

        // mark this property has used
        (map[objectName] ??= { classes: {} }).classes[className] = true;
      },
      'Program:exit' () {
        /*
           Check if all classes defined in css/scss file are used
         */

        /*
           we are looping over each import style node in program
           example:
           ```
             import s from './foo.css';
             import x from './bar.scss';
           ```
           then the loop will be run 2 times
         */
        for (const o of Object.values(map)) {
          const { classes, node, filePath } = o;

          /*
             if option is passed to mark a class as used, example:
             eslint css-modules/no-unused-class: [2, { markAsUsed: ['container'] }]
           */
          for (const usedClass of markAsUsed ?? []) {
            classes[usedClass] = true;
          }

          // classNames not marked as true are unused
          const unusedClasses = Object.entries(classes).filter(([_k, v]) => !v).map(([k, _v]) => k);

          if (unusedClasses.length > 0) {
            context.report(node, `Unused classes found in ${path.basename(filePath)}: ${unusedClasses.join(', ')}`);
          }
        }
      }
    };
  }
};
