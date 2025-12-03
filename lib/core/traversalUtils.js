// @flow
/* eslint-disable no-param-reassign */

import type { gASTNode } from '../types/index.js';

type classMapType = {
  [key: string]: boolean,
}

export const getICSSExportPropsMap = (ast: gASTNode): classMapType => {
  const ruleSets: Array<gASTNode> = [];
  ast.traverseByType('ruleset', node => ruleSets.push(node));

  return ruleSets
    .filter(ruleSet => {
      const content = ruleSet.content || [];
      return content.some(item =>
        item.type === 'selector' &&
        item.content?.some(selectorItem =>
          selectorItem.type === 'pseudoClass' &&
          selectorItem.content?.some(pseudoItem =>
            pseudoItem.type === 'ident' && pseudoItem.content === 'export'
          )
        )
      );
    })
    .reduce((result, ruleSet) => {
      const declarations = (ruleSet.content || [])
        .filter(item => item.type === 'block')
        .flatMap(block => (block.content || []))
        .filter(item => item.type === 'declaration');

      for (const declaration of declarations) {
        const property = (declaration.content || []).find(item => item.type === 'property');
        const propName = (property?.content || [])[0]?.content;
        if (propName) {
          result[propName] = propName;
        }
      }

      return result;
    }, {});
};

export const getRegularClassesMap = (ast: gASTNode): classMapType => {
  const ruleSets: Array<gASTNode> = [];
  ast.traverseByType('ruleset', node => ruleSets.push(node));

  return ruleSets
    .reduce((result, ruleSet) => {
      const selectors = ruleSet.content?.filter(item => item.type === 'selector') ?? [];
      for (const selector of selectors) {
        const classes = selector.content?.filter(item => item.type === 'class') ?? [];
        for (const classNode of classes) {
          const ident = classNode.content?.find(item => item.type === 'ident');
          if (ident?.content) {
            result[ident.content] = false;
          }
        }
      }
      return result;
    }, {});
};

export const getComposesClassesMap = (ast: gASTNode): classMapType => {
  const declarations = [];
  ast.traverseByType('declaration', node => declarations.push(node));

  return declarations
    .reduce((result, declaration) => {
      const content = declaration.content;
      const property = content?.find(item => item.type === 'property');
      const hasComposes = property?.content?.some(item =>
        item.type === 'ident' && item.content === 'composes'
      );

      if (!hasComposes) return result;

      const value = content?.find(item => item.type === 'value');
      const valueContent = value?.content;

      // Reject classes composing from other files, e.g. `composes: foo from './other.css'`
      if (valueContent?.some(item => item.type === 'ident' && item.content === 'from')) {
        return result;
      }

      // Extract and mark composed classes
      const composedClasses = valueContent?.filter(item => item.type === 'ident' && item.content) ?? [];
      for (const item of composedClasses) {
        result[item.content] = true;
      }

      return result;
    }, {});
};

export const getExtendClassesMap = (ast: gASTNode): classMapType => {
  const extendNodes = [];
  ast.traverseByType('extend', node => extendNodes.push(node));

  return extendNodes.reduce((result, extendNode) => {
    const selector = extendNode.content?.find(item => item.type === 'selector');
    const classNode = selector?.content?.find(item => item.type === 'class');
    const ident = classNode?.content?.find(item => item.type === 'ident');
    const className = ident?.content;

    if (className) {
      result[className] = true; // mark extend classes as true
    }

    return result;
  }, {});
};

/**
 * Resolves parent selectors to their full class names.
 *
 * E.g. `.foo { &_bar {color: blue } }` to `.foo_bar`.
 */
export const getParentSelectorClassesMap = (ast: gASTNode): classMapType => {
  const classesMap: classMapType = {};

  // Recursively traverses down the tree looking for parent selector
  // extensions. Recursion is necessary as these selectors can be nested.
  const getExtensions = nodeContent => {
    const blockContent = nodeContent
      .filter(item => item.type === 'block')
      .flatMap(item => item.content || []);

    const rulesetChildren = blockContent.filter(item => item.type === 'ruleset');

    const rulesetDescendants = blockContent
      .filter(item => item.type === 'include')
      .flatMap(item => item.content || [])
      .filter(subItem => subItem.type === 'block')
      .flatMap(subItem => subItem.content || [])
      .filter(subItem => subItem.type === 'ruleset');

    const rulesetsContent = [...rulesetChildren, ...rulesetDescendants]
      .flatMap(item => item.content || []);

    const extensions = rulesetsContent
      .filter(item => item.type === 'selector')
      .flatMap(item => item.content || [])
      .filter(selectorItem => selectorItem.type === 'parentSelectorExtension')
      .flatMap(selectorItem => selectorItem.content || [])
      .filter(identItem => identItem.type === 'ident')
      .map(identItem => identItem.content);

    if (!extensions.length) return [];

    const nestedExtensions = getExtensions(rulesetsContent);
    const result = extensions;
    if (nestedExtensions.length) {
      for (const nestedExt of nestedExtensions) {
        extensions.forEach(ext => {
          result.push(ext + nestedExt);
        });
      }
    }

    return result;
  };

  ast.traverseByType('ruleset', node => {
    const classNames = (node.content || [])
      .filter(item => item.type === 'selector')
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'class')
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'ident' && item.content)
      .map(item => item.content);

    if (!classNames.length) return;

    const extensions = getExtensions(node.content);
    if (!extensions.length) return;

    classNames.forEach(className => {
      extensions.forEach(ext => {
        classesMap[className + ext] = false;
      });

      // Ignore the base class if it only exists for nesting parent selectors
      const hasDeclarations = node.content?.some(item => item.type === 'block' &&
          item.content?.some(subItem => subItem.type === 'declaration'));
      if (!hasDeclarations) classesMap[className] = true;
    });
  });

  return classesMap;
};

/**
 * Mutates the AST by removing `:global` instances.
 *
 * For the AST structure:
 * @see https://github.com/css/gonzales/blob/master/doc/AST.CSSP.en.md
 */
export const eliminateGlobals = (ast: gASTNode) => {
  // Remove all :global/:global(...) in selectors
  ast.traverseByType('selector', (selectorNode) => {
    const selectorContent = selectorNode.content;
    let hasGlobalWithNoArgs = false;
    let i = 0;
    let currNode = selectorContent[i];
    while (currNode) {
      if (currNode.is('pseudoClass')) {
        // Remove all :global/:global(...) and trailing space
        const identifierNode = currNode.content[0];
        if (identifierNode && identifierNode.content === 'global') {
          if (currNode.content.length === 1) hasGlobalWithNoArgs = true;
          selectorNode.removeChild(i);
          if (selectorContent[i] && selectorContent[i].is('space')) {
            selectorNode.removeChild(i);
          }
        } else {
          i++;
        }
      } else if (currNode.is('class') && hasGlobalWithNoArgs) {
        // Remove all class after :global and their trailing space
        selectorNode.removeChild(i);
        if (selectorContent[i] && selectorContent[i].is('space')) {
          selectorNode.removeChild(i);
        }
      } else {
        i++;
      }

      currNode = selectorContent[i];
    }
  });

  // Remove all ruleset with no selectors
  ast.traverseByType('ruleset', (node, index, parent) => {
    const rulesetContent = node.content;

    // Remove empty selectors and trailing deliminator and space
    let i = 0;
    let currNode = rulesetContent[i];
    while (currNode) {
      if (currNode.is('selector') && currNode.content.length === 0) {
        node.removeChild(i);
        if (rulesetContent[i].is('delimiter')) node.removeChild(i);
        if (rulesetContent[i].is('space')) node.removeChild(i);
      } else {
        i++;
      }
      currNode = rulesetContent[i];
    }

    // Remove the ruleset if no selectors
    if (rulesetContent.filter((node) => node.is('selector')).length === 0) {
      parent.removeChild(index);
    }
  });
};
